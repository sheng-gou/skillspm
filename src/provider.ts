import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import semver from "semver";
import { CliError } from "./errors";
import type { ScopeLayout } from "./scope";
import type { LibrarySkillSource, LockedSkillResolvedFrom, ManifestSkill } from "./types";
import {
  assertNoSymlinksInTree,
  assertPathWithinRootReal,
  assertSkillRootMarker,
  buildInstalledEntryName,
  copyDir,
  ensureDir,
  exists,
  isDirectory
} from "./utils";

const execFileAsync = promisify(execFile);
const TEST_GITHUB_ROOT_ENV = "SKILLSPM_TEST_GITHUB_ROOT";
const TEST_SKILLS_SH_BASE_URL_ENV = "SKILLSPM_TEST_SKILLS_SH_BASE_URL";
const TEST_OPENCLAW_BASE_URL_ENV = "SKILLSPM_TEST_OPENCLAW_BASE_URL";
const TEST_CLAWHUB_BASE_URL_ENV = "SKILLSPM_TEST_CLAWHUB_BASE_URL";
const PROVIDER_RECOVERY_GIT_CONFIG = ["-c", "credential.helper=", "-c", "core.askPass=", "-c", "credential.interactive=never"];
const FETCH_TIMEOUT_MS = 20_000;
const PUBLIC_PROVIDER_NAMES = new Set(["github", "openclaw", "clawhub", "skills.sh"]);
const INVALID_GITHUB_SEGMENT_PATTERN = /[\\:@?#\s]/u;

export interface ProviderMaterializationResult {
  installPath?: string;
  materializedSource?: LibrarySkillSource;
  failureReason?: string;
}

export interface PublicGitHubSourceCandidates {
  applicable: boolean;
  sources?: LibrarySkillSource[];
  failureReason?: string;
}

export interface ProviderBootstrapResult {
  manifestSkill: ManifestSkill;
  materializedPath: string;
  source: LibrarySkillSource;
  cleanup(): Promise<void>;
}

interface ParsedGitHubSkillId {
  owner: string;
  repo: string;
  skillPath?: string;
}

interface ParsedProviderSkillId {
  provider: string;
  value: string;
}

interface GitTagCandidate {
  version: string;
  ref: string;
}

interface ResolvedPublicProjectLocator {
  applicable: boolean;
  locator?: string;
  providerName?: string;
  failureReason?: string;
  versions?: string[];
}

export async function bootstrapPublicProviderSkill(
  layout: ScopeLayout,
  _input: string,
  canonicalId: string,
  requestedVersion?: string
): Promise<ProviderBootstrapResult | undefined> {
  const resolvedVersion = await selectPublicProviderProjectVersion(canonicalId, requestedVersion);
  if (!resolvedVersion) {
    const locator = await resolvePublicProjectLocator(canonicalId);
    if (!locator.applicable) {
      return undefined;
    }
    throw new CliError(locator.failureReason ?? `Unable to resolve a public provider source for ${canonicalId}`, 3);
  }

  const candidates = await inferPublicGitHubProjectSourceCandidates(canonicalId, resolvedVersion);
  if (!candidates.applicable) {
    return undefined;
  }
  if (!candidates.sources || candidates.sources.length === 0) {
    throw new CliError(candidates.failureReason ?? `Unable to infer a public source for ${canonicalId}@${resolvedVersion}`, 3);
  }

  const failures: string[] = [];
  for (const candidate of candidates.sources) {
    const materialized = await materializeProviderSource(layout, canonicalId, resolvedVersion, candidate);
    if (!materialized.installPath) {
      failures.push(materialized.failureReason ?? `public provider bootstrap failed for ${canonicalId}@${resolvedVersion}`);
      continue;
    }

    const recordedSource = buildRecordedProviderLibrarySource(canonicalId, candidate);
    return {
      manifestSkill: {
        id: canonicalId,
        version: resolvedVersion,
        source: recordedSource
      },
      materializedPath: materialized.installPath,
      source: recordedSource,
      cleanup: async () => {}
    };
  }

  throw new CliError(
    failures.length > 0 ? failures.join("; ") : `Unable to materialize ${canonicalId}@${resolvedVersion}`,
    3
  );
}

export async function materializeProviderSource(
  layout: ScopeLayout,
  skillId: string,
  version: string,
  source: LibrarySkillSource
): Promise<ProviderMaterializationResult> {
  const candidates = buildGitHubMaterializationCandidates(source, version);
  if (!candidates.applicable) {
    return {
      failureReason: candidates.failureReason
    };
  }
  if (!candidates.sources || candidates.sources.length === 0) {
    return {
      failureReason: candidates.failureReason ?? `recorded provider source is insufficient for re-materialization: ${skillId}@${version}`
    };
  }

  const cachePath = path.join(layout.librarySkillsDir, buildInstalledEntryName(skillId, version));
  const failures: string[] = [];
  for (const candidate of candidates.sources) {
    const githubSource = parseGitHubProviderSource(candidate);
    if (!githubSource.ok) {
      failures.push(githubSource.failureReason);
      continue;
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-provider-"));
    const checkoutDir = path.join(tempRoot, "repo");
    try {
      await ensureDir(layout.librarySkillsDir);
      const repoUrl = await resolveGitHubRepoUrl(githubSource.parsed.owner, githubSource.parsed.repo);
      await runGit(["clone", "--depth", "1", "--no-checkout", repoUrl, checkoutDir]);
      await runGit(["-C", checkoutDir, "fetch", "--depth", "1", "origin", githubSource.ref]);
      await runGit(["-C", checkoutDir, "checkout", "--detach", "FETCH_HEAD"]);

      const materializedRoot = githubSource.parsed.skillPath
        ? path.resolve(checkoutDir, githubSource.parsed.skillPath)
        : checkoutDir;
      await assertPathWithinRootReal(checkoutDir, materializedRoot, `Recorded provider source path for ${skillId}@${version}`);

      if (!(await exists(materializedRoot)) || !(await isDirectory(materializedRoot))) {
        failures.push(`recorded provider source path is missing in fetched github ref ${githubSource.ref}: ${candidate.value}`);
        continue;
      }

      try {
        await assertSkillRootMarker(materializedRoot, `Recorded provider source for ${skillId}@${version}`);
        await assertNoSymlinksInTree(materializedRoot, `Recorded provider source for ${skillId}@${version}`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `recorded provider source is not a valid skill root: ${candidate.value}`);
        continue;
      }

      await copyDir(materializedRoot, cachePath, { dereference: true });
      return {
        installPath: cachePath,
        materializedSource: candidate
      };
    } catch (error) {
      await rm(cachePath, { recursive: true, force: true });
      failures.push(buildGitHubFetchFailureReason(candidate.value, githubSource.ref, error));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  return {
    failureReason: failures.join("; ")
  };
}

export function inferPublicGitHubLockfileSourceCandidates(
  resolvedFrom: LockedSkillResolvedFrom | undefined,
  version: string
): PublicGitHubSourceCandidates {
  if (!resolvedFrom || resolvedFrom.type !== "provider") {
    return {
      applicable: false
    };
  }

  if (!parseGitHubSourceValue(resolvedFrom.ref)) {
    return {
      applicable: true,
      failureReason:
        "locked provider provenance is insufficient for public github recovery: expected resolved_from.ref to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator"
    };
  }

  return buildPublicGitHubSourceCandidates(
    resolvedFrom.ref,
    version,
    `locked provider provenance is insufficient for public github recovery: ${resolvedFrom.ref} is unversioned, so no exact public ref can be inferred`
  );
}

export async function inferPublicGitHubProjectSourceCandidates(skillId: string, version: string): Promise<PublicGitHubSourceCandidates> {
  const resolved = await resolvePublicProjectLocator(skillId);
  if (!resolved.applicable) {
    return {
      applicable: false
    };
  }
  if (!resolved.locator) {
    return {
      applicable: true,
      failureReason: resolved.failureReason ?? `persisted project semantics are insufficient for public provider recovery: ${skillId}`
    };
  }

  return buildPublicGitHubSourceCandidates(
    resolved.locator,
    version,
    `persisted project semantics are insufficient for public provider recovery: ${skillId} is unversioned, so no exact public ref can be inferred`
  );
}

export async function selectPublicProviderProjectVersion(skillId: string, requestedRange?: string): Promise<string | undefined> {
  if (requestedRange === "unversioned") {
    return undefined;
  }

  const resolved = await resolvePublicProjectLocator(skillId);
  if (!resolved.applicable || !resolved.locator) {
    return undefined;
  }

  if (resolved.providerName === "openclaw" || resolved.providerName === "clawhub") {
    const selected = selectVersionFromList(resolved.versions ?? [], requestedRange);
    if (selected) {
      return selected;
    }
  }

  const selectedTag = await selectVersionFromGitHubLocator(resolved.locator, requestedRange);
  return selectedTag?.version;
}

export function supportsPublicProviderRecoverySkillId(skillId: string): boolean {
  const providerId = parseProviderSkillId(skillId);
  if (!providerId || !PUBLIC_PROVIDER_NAMES.has(providerId.provider) || providerId.value.length === 0) {
    return false;
  }
  return providerId.provider !== "github" || parseGitHubSkillId(skillId) !== undefined;
}

export function canonicalizePublicGitHubLocator(value: string): string | undefined {
  const parsed = parseGitHubSourceValue(value);
  return parsed ? buildCanonicalGitHubLocator(parsed) : undefined;
}

export function getLockedProviderRefForLibrarySource(source: LibrarySkillSource): string | undefined {
  if (source.kind !== "provider") {
    return undefined;
  }
  if (source.provider?.name === "github") {
    return source.value;
  }
  if (source.provider?.ref && parseGitHubSourceValue(source.provider.ref)) {
    return source.provider.ref;
  }
  return undefined;
}

export function getPublicGitHubProjectFallbackFailureReason(source: LibrarySkillSource | undefined): string | undefined {
  if (!source || source.kind !== "provider" || !source.provider) {
    return undefined;
  }

  if (!PUBLIC_PROVIDER_NAMES.has(source.provider.name)) {
    return `recorded provider source is insufficient for re-materialization: only public github/openclaw/clawhub/skills.sh provider provenance is supported, received ${source.provider.name}`;
  }

  if (source.provider.visibility !== undefined && source.provider.visibility !== "public") {
    return "recorded provider source is insufficient for re-materialization: public provider recovery only supports source.provider.visibility=public";
  }

  if (source.provider.name === "github") {
    if (!parseGitHubSourceValue(source.value)) {
      return "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator";
    }
    return undefined;
  }

  if (!source.provider.ref || !parseGitHubSourceValue(source.provider.ref)) {
    return "recorded provider source is insufficient for re-materialization: expected source.provider.ref to be a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator";
  }

  return undefined;
}

export function buildRecordedProviderLibrarySource(skillId: string, source: LibrarySkillSource): LibrarySkillSource {
  if (source.kind !== "provider" || source.provider?.name !== "github") {
    return source;
  }

  const parsedProvider = parseProviderSkillId(skillId);
  if (!parsedProvider || parsedProvider.provider === "github") {
    return source;
  }

  return {
    kind: "provider",
    value: skillId,
    provider: {
      name: parsedProvider.provider,
      ref: source.value,
      visibility: "public"
    }
  };
}

function buildGitHubMaterializationCandidates(source: LibrarySkillSource, version: string): PublicGitHubSourceCandidates {
  if (source.kind !== "provider") {
    return {
      applicable: false,
      failureReason: `recorded source.kind must be provider for provider re-materialization, received ${source.kind}`
    };
  }

  if (!source.provider) {
    return {
      applicable: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: expected source.provider.name and public visibility metadata in library.yaml"
    };
  }

  if (source.provider.visibility !== undefined && source.provider.visibility !== "public") {
    return {
      applicable: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: public provider recovery only supports source.provider.visibility=public"
    };
  }

  if (source.provider.name === "github") {
    if (!parseGitHubSourceValue(source.value)) {
      return {
        applicable: false,
        failureReason:
          "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator"
      };
    }
    if (source.provider.ref) {
      return {
        applicable: true,
        sources: [source]
      };
    }
    return buildPublicGitHubSourceCandidates(
      source.value,
      version,
      `recorded provider source is insufficient for re-materialization: ${source.value} is unversioned, so no exact public ref can be inferred`
    );
  }

  if (!PUBLIC_PROVIDER_NAMES.has(source.provider.name)) {
    return {
      applicable: false,
      failureReason: `recorded provider source is insufficient for re-materialization: only public github/openclaw/clawhub/skills.sh provider provenance is supported, received ${source.provider.name}`
    };
  }

  if (!source.provider.ref || !parseGitHubSourceValue(source.provider.ref)) {
    return {
      applicable: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: expected source.provider.ref to be a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator"
    };
  }

  return buildPublicGitHubSourceCandidates(
    source.provider.ref,
    version,
    `recorded provider source is insufficient for re-materialization: ${source.value} is unversioned, so no exact public ref can be inferred`
  );
}

function parseGitHubProviderSource(source: LibrarySkillSource):
  | { ok: true; parsed: ParsedGitHubSkillId; ref: string }
  | { ok: false; failureReason: string } {
  if (source.kind !== "provider") {
    return {
      ok: false,
      failureReason: `recorded source.kind must be provider for provider re-materialization, received ${source.kind}`
    };
  }

  if (source.provider?.name !== "github") {
    return {
      ok: false,
      failureReason: `recorded provider source is insufficient for re-materialization: expected provider.name=github, received ${source.provider?.name ?? "<missing>"}`
    };
  }

  if (!source.provider.ref) {
    return {
      ok: false,
      failureReason: "recorded provider source is insufficient for re-materialization: github recovery requires source.provider.ref"
    };
  }

  const parsed = parseGitHubSourceValue(source.value);
  if (!parsed) {
    return {
      ok: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator"
    };
  }

  return {
    ok: true,
    parsed,
    ref: source.provider.ref
  };
}

function buildPublicGitHubSourceCandidates(
  sourceValue: string,
  version: string,
  unversionedFailureReason: string
): PublicGitHubSourceCandidates {
  if (version === "unversioned") {
    return {
      applicable: true,
      failureReason: unversionedFailureReason
    };
  }

  const refs = [...new Set([`refs/tags/v${version}`, `refs/tags/${version}`])];
  return {
    applicable: true,
    sources: refs.map((ref) => ({
      kind: "provider",
      value: sourceValue,
      provider: {
        name: "github",
        ref,
        visibility: "public"
      }
    }))
  };
}

async function resolvePublicProjectLocator(skillId: string): Promise<ResolvedPublicProjectLocator> {
  const providerId = parseProviderSkillId(skillId);
  if (!providerId) {
    return {
      applicable: false
    };
  }

  if (providerId.provider === "github") {
    if (!parseGitHubSourceValue(skillId)) {
      return {
        applicable: true,
        providerName: providerId.provider,
        failureReason: `persisted project semantics are insufficient for public provider recovery: ${skillId} is not a canonical public github id`
      };
    }
    return {
      applicable: true,
      providerName: providerId.provider,
      locator: skillId
    };
  }

  if (providerId.provider === "skills.sh") {
    const locator = await resolveSkillsShGitHubLocator(providerId.value);
    if (!locator) {
      return {
        applicable: true,
        providerName: providerId.provider,
        failureReason: `public ${providerId.provider} bootstrap is insufficient for ${providerId.value}`
      };
    }
    return {
      applicable: true,
      providerName: providerId.provider,
      locator
    };
  }

  if (providerId.provider === "openclaw" || providerId.provider === "clawhub") {
    const locator = await resolveClawHubGitHubLocator(providerId.provider, providerId.value);
    if (!locator) {
      return {
        applicable: true,
        providerName: providerId.provider,
        failureReason: `public ${providerId.provider} bootstrap is insufficient for ${providerId.value}`
      };
    }
    return {
      applicable: true,
      providerName: providerId.provider,
      locator,
      versions: await fetchClawHubVersions(providerId.provider, providerId.value)
    };
  }

  return {
    applicable: false
  };
}

function parseGitHubSourceValue(value: string): ParsedGitHubSkillId | undefined {
  return parseGitHubSkillId(value) ?? parseGitHubUrl(value);
}

function parseGitHubSkillId(value: string): ParsedGitHubSkillId | undefined {
  if (!value.startsWith("github:")) {
    return undefined;
  }
  return parseCanonicalGitHubPath(value.slice("github:".length));
}

function parseGitHubUrl(value: string): ParsedGitHubSkillId | undefined {
  if (!value.startsWith("https://github.com/") || value.includes("\\")) {
    return undefined;
  }

  const rawPath = value.slice("https://github.com".length).split(/[?#]/u, 1)[0];
  if (!isCanonicalGitHubRawPath(rawPath)) {
    return undefined;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return undefined;
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    return undefined;
  }

  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    return undefined;
  }

  const normalizedPath = parsedUrl.pathname;
  if (!normalizedPath.startsWith("/") || normalizedPath.length <= 1) {
    return undefined;
  }

  const segments = normalizedPath.slice(1).split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  if (segments[2] === "tree" || segments[2] === "blob") {
    if (segments.length < 5 || !isCanonicalGitHubSegment(segments[3])) {
      return undefined;
    }
    return buildParsedGitHubSkillId(segments[0], segments[1], segments.slice(4), { allowDotGitRepo: false });
  }

  return buildParsedGitHubSkillId(segments[0], segments[1], segments.slice(2), { allowDotGitRepo: false });
}

function parseCanonicalGitHubPath(value: string): ParsedGitHubSkillId | undefined {
  if (!value || value.includes("\\") || value.includes("?") || value.includes("#")) {
    return undefined;
  }

  if (!isCanonicalGitHubRawPath(value)) {
    return undefined;
  }

  const segments = value.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  return buildParsedGitHubSkillId(segments[0], segments[1], segments.slice(2), { allowDotGitRepo: false });
}

function buildParsedGitHubSkillId(
  owner: string,
  repoSegment: string,
  skillSegments: string[],
  options: { allowDotGitRepo: boolean }
): ParsedGitHubSkillId | undefined {
  if (!isCanonicalGitHubSegment(owner)) {
    return undefined;
  }

  if (!isCanonicalGitHubSegment(repoSegment)) {
    return undefined;
  }

  if (repoSegment.endsWith(".git")) {
    if (!options.allowDotGitRepo) {
      return undefined;
    }
    repoSegment = repoSegment.slice(0, -4);
    if (!isCanonicalGitHubSegment(repoSegment)) {
      return undefined;
    }
  }

  if (skillSegments.some((segment) => !isCanonicalGitHubSegment(segment))) {
    return undefined;
  }

  return {
    owner,
    repo: repoSegment,
    ...(skillSegments.length > 0 ? { skillPath: skillSegments.join("/") } : {})
  };
}

function isCanonicalGitHubSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === ".." || INVALID_GITHUB_SEGMENT_PATTERN.test(segment)) {
    return false;
  }

  if (!segment.includes("%")) {
    return true;
  }

  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length > 0
      && decoded !== "."
      && decoded !== ".."
      && !decoded.includes("/")
      && !decoded.includes("\\")
      && !INVALID_GITHUB_SEGMENT_PATTERN.test(decoded);
  } catch {
    return false;
  }
}

function isCanonicalGitHubRawPath(value: string): boolean {
  if (!value) {
    return false;
  }

  const segments = value.startsWith("/") ? value.slice(1).split("/") : value.split("/");
  return segments.length >= 2 && segments.every((segment) => isCanonicalGitHubRawSegment(segment));
}

function isCanonicalGitHubRawSegment(segment: string): boolean {
  return isCanonicalGitHubSegment(segment);
}

function parseProviderSkillId(value: string): ParsedProviderSkillId | undefined {
  const match = value.match(/^([a-z][a-z0-9_.-]*):(.*)$/u);
  if (!match) {
    return undefined;
  }
  return {
    provider: match[1],
    value: match[2]
  };
}

function buildCanonicalGitHubLocator(parsed: ParsedGitHubSkillId): string {
  return `github:${parsed.owner}/${parsed.repo}${parsed.skillPath ? `/${parsed.skillPath}` : ""}`;
}

async function resolveSkillsShGitHubLocator(value: string): Promise<string | undefined> {
  const direct = parseSkillsShGitHubLocator(value);
  if (direct) {
    return direct;
  }

  const baseUrl = process.env[TEST_SKILLS_SH_BASE_URL_ENV] ?? "https://skills.sh";
  const page = await fetchText(`${baseUrl.replace(/\/+$/u, "")}/${value}`);
  if (!page) {
    return undefined;
  }
  return extractGitHubLocatorFromText(page);
}

function parseSkillsShGitHubLocator(value: string): string | undefined {
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 3) {
    return undefined;
  }
  return `github:${segments[0]}/${segments[1]}/${segments.slice(2).join("/")}`;
}

async function resolveClawHubGitHubLocator(providerName: string, slug: string): Promise<string | undefined> {
  const baseUrl = getClawHubBaseUrl(providerName);
  const apiText = await fetchText(`${baseUrl}/api/v1/skills/${slug}`);
  if (apiText) {
    const locatorFromJson = extractGitHubLocatorFromJson(apiText);
    if (locatorFromJson) {
      return locatorFromJson;
    }
    const locatorFromText = extractGitHubLocatorFromText(apiText);
    if (locatorFromText) {
      return locatorFromText;
    }
  }

  const pageText = await fetchText(`${baseUrl}/skills/${slug}`);
  if (!pageText) {
    return undefined;
  }
  return extractGitHubLocatorFromText(pageText);
}

async function fetchClawHubVersions(providerName: string, slug: string): Promise<string[]> {
  const baseUrl = getClawHubBaseUrl(providerName);
  const text = await fetchText(`${baseUrl}/api/v1/skills/${slug}/versions`);
  if (!text) {
    return [];
  }

  try {
    const data = JSON.parse(text) as unknown;
    return collectVersions(data);
  } catch {
    return [];
  }
}

function collectVersions(value: unknown): string[] {
  if (typeof value === "string") {
    return semver.valid(value) === value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => collectVersions(entry)))];
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = typeof record.version === "string" && semver.valid(record.version) === record.version ? [record.version] : [];
  return [
    ...direct,
    ...collectVersions(record.versions),
    ...collectVersions(record.items),
    ...collectVersions(record.data)
  ].filter((entry, index, list) => list.indexOf(entry) === index);
}

function getClawHubBaseUrl(providerName: string): string {
  if (providerName === "openclaw") {
    return (process.env[TEST_OPENCLAW_BASE_URL_ENV] ?? process.env[TEST_CLAWHUB_BASE_URL_ENV] ?? "https://clawhub.ai").replace(/\/+$/u, "");
  }
  return (process.env[TEST_CLAWHUB_BASE_URL_ENV] ?? process.env[TEST_OPENCLAW_BASE_URL_ENV] ?? "https://clawhub.ai").replace(/\/+$/u, "");
}

function extractGitHubLocatorFromJson(text: string): string | undefined {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const candidates = [data.github_url, data.githubUrl, data.repository_url, data.repositoryUrl, data.source_url, data.sourceUrl];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const parsed = parseGitHubSourceValue(candidate);
        if (parsed) {
          return buildCanonicalGitHubLocator(parsed);
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractGitHubLocatorFromText(text: string): string | undefined {
  const commandMatch = text.match(/npx\s+skills\s+add\s+(https:\/\/github\.com\/[^\s"'<>]+)(?:\s+--skill\s+([^\s"'<>]+))?/iu);
  if (commandMatch) {
    const repoParsed = parseGitHubSourceValue(commandMatch[1]);
    if (repoParsed) {
      const skillPath = commandMatch[2];
      return buildCanonicalGitHubLocator({
        owner: repoParsed.owner,
        repo: repoParsed.repo,
        ...(skillPath ? { skillPath } : repoParsed.skillPath ? { skillPath: repoParsed.skillPath } : {})
      });
    }
  }

  const githubUrlMatch = text.match(/https:\/\/github\.com\/[^\s"'<>]+/iu);
  if (!githubUrlMatch) {
    return undefined;
  }
  const parsed = parseGitHubSourceValue(githubUrlMatch[0]);
  return parsed ? buildCanonicalGitHubLocator(parsed) : undefined;
}

async function selectVersionFromGitHubLocator(locator: string, requestedRange?: string): Promise<GitTagCandidate | undefined> {
  const tags = await listPublicGitHubTags(locator);
  if (tags.length === 0) {
    return undefined;
  }

  if (!requestedRange) {
    const latest = semver.rsort(tags.map((tag) => tag.version))[0];
    return latest ? tags.find((tag) => tag.version === latest) : undefined;
  }

  if (semver.valid(requestedRange) === requestedRange) {
    return tags.find((tag) => tag.version === requestedRange);
  }

  const matched = semver.maxSatisfying(tags.map((tag) => tag.version), requestedRange);
  return matched ? tags.find((tag) => tag.version === matched) : undefined;
}

async function listPublicGitHubTags(locator: string): Promise<GitTagCandidate[]> {
  const parsed = parseGitHubSourceValue(locator);
  if (!parsed) {
    return [];
  }

  const repoUrl = await resolveGitHubRepoUrl(parsed.owner, parsed.repo);
  try {
    const { stdout } = await execFileAsync("git", [...PROVIDER_RECOVERY_GIT_CONFIG, "ls-remote", "--tags", "--refs", repoUrl], {
      env: buildGitEnv(),
      maxBuffer: 10 * 1024 * 1024
    });
    const byVersion = new Map<string, GitTagCandidate>();
    for (const line of stdout.split(/\r?\n/u)) {
      const match = line.match(/\srefs\/tags\/(.+)$/u);
      if (!match) {
        continue;
      }
      const tagName = match[1];
      const normalized = normalizeSemverTag(tagName);
      if (!normalized) {
        continue;
      }
      const ref = `refs/tags/${tagName}`;
      const existing = byVersion.get(normalized);
      if (!existing || ref === `refs/tags/v${normalized}`) {
        byVersion.set(normalized, { version: normalized, ref });
      }
    }
    return [...byVersion.values()];
  } catch {
    return [];
  }
}

function normalizeSemverTag(tag: string): string | undefined {
  if (semver.valid(tag) === tag) {
    return tag;
  }
  if (tag.startsWith("v") && semver.valid(tag.slice(1)) === tag.slice(1)) {
    return tag.slice(1);
  }
  return undefined;
}

function selectVersionFromList(versions: string[], requestedRange?: string): string | undefined {
  const validVersions = versions.filter((version) => semver.valid(version) === version);
  if (validVersions.length === 0) {
    return undefined;
  }

  if (!requestedRange) {
    return semver.rsort(validVersions)[0];
  }
  if (semver.valid(requestedRange) === requestedRange) {
    return validVersions.includes(requestedRange) ? requestedRange : undefined;
  }
  return semver.maxSatisfying(validVersions, requestedRange) ?? undefined;
}

async function fetchText(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//iu.test(url)) {
    for (const candidate of localFixtureCandidates(url)) {
      if (await exists(candidate)) {
        return readFile(candidate, "utf8");
      }
    }
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "skillspm/0.3.0"
      }
    });
    if (!response.ok) {
      return undefined;
    }
    return await response.text();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function localFixtureCandidates(value: string): string[] {
  if (path.extname(value)) {
    return [value];
  }
  return [value, `${value}.json`, `${value}.html`, path.join(value, "index.json"), path.join(value, "index.html")];
}

async function resolveGitHubRepoUrl(owner: string, repo: string): Promise<string> {
  const testRoot = process.env[TEST_GITHUB_ROOT_ENV];
  if (testRoot) {
    if (/^https?:\/\//i.test(testRoot)) {
      return `${testRoot.replace(/\/+$/, "")}/${owner}/${repo}.git`;
    }

    const bareCandidate = path.join(testRoot, owner, `${repo}.git`);
    if (await exists(bareCandidate)) {
      return bareCandidate;
    }

    const candidate = path.join(testRoot, owner, repo);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return `https://github.com/${owner}/${repo}.git`;
}

async function runGit(args: string[]): Promise<void> {
  await execFileAsync("git", [...PROVIDER_RECOVERY_GIT_CONFIG, ...args], {
    env: buildGitEnv(),
    maxBuffer: 10 * 1024 * 1024
  });
}

function buildGitEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  } as NodeJS.ProcessEnv;

  for (const key of Object.keys(env)) {
    if (key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_COUNT") || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) {
      delete env[key];
    }
  }

  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  return env;
}

function buildGitHubFetchFailureReason(sourceValue: string, ref: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `public github fetch failed for ${sourceValue} at ${ref}: ${detail}. Public github recovery only supports unauthenticated access to public GitHub repos in this build`;
}
