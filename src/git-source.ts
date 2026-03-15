import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import { loadSkillMetadata } from "./skill";
import type { ManifestSource } from "./types";
import { ensureDir, exists, isDirectory, sanitizeSkillId } from "./utils";

const execFileAsync = promisify(execFile);
const GIT_SKILLS_ROOT = "skills";
const SCP_LIKE_GIT_URL_PATTERN = /^[^/@\s]+@[^:/\s]+:.+$/;
const CANONICAL_PROVIDER_REF_PATTERN = /^(skills\.sh|clawhub):([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/;
const CANONICAL_PROVIDER_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const GIT_SKILL_SCAN_SKIP_DIRS = new Set([".git", ".skills", "dist", "node_modules", "vendor"]);
const GIT_HARDENED_CONFIG_ARGS = [
  "-c", "credential.helper=",
  "-c", "core.askPass=",
  "-c", "credential.interactive=never",
  "-c", "protocol.file.allow=never"
] as const;

export const PHASE1_GIT_SOURCE_POLICY_MESSAGE = "Phase 1 only supports public anonymous HTTPS git sources.";
export const CANONICAL_PROVIDER_REF_USAGE = "Use skills.sh:owner/repo/skill, clawhub:owner/repo/skill, or https://skills.sh/owner/repo/skill.";

export interface CanonicalProviderSkillReference {
  provider: "skills.sh" | "clawhub";
  owner: string;
  repo: string;
  skill: string;
  ref: string;
  canonicalRef: string;
  cloneUrl: string;
}

interface GitSkillCandidate {
  path: string;
  name: string;
  metadataId?: string;
  version?: string;
}

export interface LoadedGitSource {
  path: string;
  revision: string;
}

export function looksLikeExplicitGitSourceUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes("://") || SCP_LIKE_GIT_URL_PATTERN.test(trimmed);
}

export function looksLikeCanonicalProviderSkillReference(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("skills.sh:") || trimmed.startsWith("clawhub:")) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === "skills.sh";
  } catch {
    return false;
  }
}

export function parseCanonicalProviderSkillReference(value: string): CanonicalProviderSkillReference | string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const refMatch = CANONICAL_PROVIDER_REF_PATTERN.exec(trimmed);
  if (refMatch) {
    return buildCanonicalProviderSkillReference(
      refMatch[1] as CanonicalProviderSkillReference["provider"],
      refMatch[2],
      refMatch[3],
      refMatch[4],
      trimmed
    );
  }
  if (trimmed.startsWith("skills.sh:") || trimmed.startsWith("clawhub:")) {
    return `Canonical provider refs must use an explicit owner/repo/skill path. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    if (looksLikeCanonicalProviderSkillReference(trimmed)) {
      return `Canonical provider refs must use an explicit owner/repo/skill path. ${CANONICAL_PROVIDER_REF_USAGE}`;
    }
    return undefined;
  }

  if (parsed.hostname !== "skills.sh") {
    return undefined;
  }
  if (parsed.protocol !== "https:") {
    return `Canonical skills.sh URLs must use https:// only. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }
  if (parsed.username || parsed.password) {
    return `Canonical skills.sh URLs cannot include embedded credentials. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }
  if (parsed.search.length > 1 || parsed.hash.length > 1) {
    return `Canonical skills.sh URLs cannot include query strings or fragments. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 3 || parsed.pathname !== `/${pathSegments.join("/")}`) {
    return `Canonical skills.sh URLs must use exactly /owner/repo/skill. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }

  return buildCanonicalProviderSkillReference("skills.sh", pathSegments[0], pathSegments[1], pathSegments[2], trimmed);
}

export function validatePhase1GitSourceUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return PHASE1_GIT_SOURCE_POLICY_MESSAGE;
  }

  const providerReference = parseCanonicalProviderSkillReference(trimmed);
  if (providerReference !== undefined) {
    const detail = typeof providerReference === "string"
      ? providerReference
      : `Canonical provider refs are resolved through \`skillspm add <provider-ref>\`, not through \`--from\` or persisted \`sources[]\`. ${CANONICAL_PROVIDER_REF_USAGE}`;
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} ${detail}`;
  }

  if (SCP_LIKE_GIT_URL_PATTERN.test(trimmed)) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} SCP-like git@host:repo URLs are not allowed.`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} Use an https:// URL without embedded credentials.`;
  }

  if (parsed.protocol !== "https:") {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} ${parsed.protocol}// URLs are not allowed.`;
  }
  if (parsed.username || parsed.password) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} URLs with embedded credentials are not allowed.`;
  }
  if (parsed.search.length > 1) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} Query strings are not allowed in Phase 1.`;
  }
  if (parsed.hash.length > 1) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} URL fragments are not allowed in Phase 1.`;
  }
  return null;
}

export async function loadGitSource(
  cacheRoot: string,
  source: ManifestSource
): Promise<LoadedGitSource> {
  const sourceUrlError = validatePhase1GitSourceUrl(source.url);
  if (sourceUrlError) {
    throw new CliError(`Unable to load git source ${source.name} from ${source.url}: ${sourceUrlError}`, 2);
  }

  const repoPath = path.join(cacheRoot, sanitizeSkillId(source.name));
  await rm(repoPath, { recursive: true, force: true });
  await ensureDir(cacheRoot);

  const gitExecutionContext = await createIsolatedGitExecutionContext();
  const gitTlsConfigArgs = buildGitTlsConfigArgs();
  try {
    try {
      await cloneGitSource(gitTlsConfigArgs, gitExecutionContext, source.url, repoPath);
    } catch (error) {
      throw new CliError(
        `Unable to clone git source ${source.name} from ${source.url}: ${formatGitError(error)}`,
        4
      );
    }

    try {
      const { stdout } = await execFileAsync("git", [...gitTlsConfigArgs, ...GIT_HARDENED_CONFIG_ARGS, "-C", repoPath, "rev-parse", "HEAD"], {
        cwd: gitExecutionContext.cwd,
        env: gitExecutionContext.env
      });
      return {
        path: repoPath,
        revision: stdout.trim()
      };
    } catch (error) {
      throw new CliError(`Unable to read git revision for ${source.name}: ${formatGitError(error)}`, 4);
    }
  } finally {
    await gitExecutionContext.cleanup();
  }
}

export async function findMatchingStrictGitSkillVersion(
  repoPath: string,
  skillId: string,
  range: string | undefined
): Promise<{ version: string; skillRoot: string }> {
  const versionedMatch = await findMatchingVersionedGitSkill(repoPath, skillId, range);
  if (versionedMatch) {
    return versionedMatch;
  }

  throw new CliError(
    `Skill ${skillId} was not found in git source layout ${GIT_SKILLS_ROOT}/<id>/<version>`,
    3
  );
}

export async function findMatchingProviderBackedGitSkillVersion(
  repoPath: string,
  skillId: string,
  range: string | undefined,
  providerRef?: string
): Promise<{ version: string; skillRoot: string }> {
  const versionedMatch = await findMatchingVersionedGitSkill(repoPath, skillId, range);
  if (versionedMatch) {
    return versionedMatch;
  }

  const candidateMatch = await findMatchingLooseGitSkill(repoPath, skillId, range, providerRef);
  if (candidateMatch) {
    return candidateMatch;
  }

  const requestedLeaf = selectProviderLookupLeaf(skillId, providerRef);
  throw new CliError(
    `Skill ${skillId} was not found in git source layout ${GIT_SKILLS_ROOT}/<id>/<version>, and no unique provider-backed skill directory matched metadata.id ${skillId} or basename ${requestedLeaf}`,
    3
  );
}

async function findMatchingVersionedGitSkill(
  repoPath: string,
  skillId: string,
  range: string | undefined
): Promise<{ version: string; skillRoot: string } | undefined> {
  const skillVersionsRoot = path.join(repoPath, GIT_SKILLS_ROOT, ...splitSkillId(skillId));
  if (!(await isDirectory(skillVersionsRoot))) {
    return undefined;
  }

  const entries = await readdir(skillVersionsRoot, { withFileTypes: true });
  const availableVersions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((version) => semver.valid(version));
  const selectedVersion = range ? semver.maxSatisfying(availableVersions, range) : semver.rsort(availableVersions)[0];
  if (!selectedVersion) {
    const detail = range ? ` matching ${range}` : "";
    throw new CliError(`Skill ${skillId} has no git repo version${detail}`, 3);
  }

  return {
    version: selectedVersion,
    skillRoot: path.join(skillVersionsRoot, selectedVersion)
  };
}

async function findMatchingLooseGitSkill(
  repoPath: string,
  skillId: string,
  range: string | undefined,
  providerRef?: string
): Promise<{ version: string; skillRoot: string } | undefined> {
  const candidates = await collectGitSkillCandidates(repoPath);
  const metadataMatches = candidates.filter((candidate) => candidate.metadataId === skillId);
  if (metadataMatches.length === 1) {
    return materializeLooseGitSkillMatch(skillId, range, metadataMatches[0], `metadata.id ${skillId}`);
  }
  if (metadataMatches.length > 1) {
    throw new CliError(`Skill ${skillId} is ambiguous in git source: found ${metadataMatches.length} directories with metadata.id ${skillId}`, 3);
  }

  const requestedLeaf = selectProviderLookupLeaf(skillId, providerRef);
  const nameMatches = candidates.filter((candidate) => candidate.name === requestedLeaf);
  if (nameMatches.length === 1) {
    return materializeLooseGitSkillMatch(skillId, range, nameMatches[0], `basename ${requestedLeaf}`);
  }
  if (nameMatches.length > 1) {
    throw new CliError(`Skill ${skillId} is ambiguous in git source: found ${nameMatches.length} directories named ${requestedLeaf}`, 3);
  }

  return undefined;
}

function materializeLooseGitSkillMatch(
  skillId: string,
  range: string | undefined,
  candidate: GitSkillCandidate,
  matchedBy: string
): { version: string; skillRoot: string } {
  const version = candidate.version ?? "unversioned";
  if (range) {
    if (!candidate.version || !semver.valid(candidate.version) || !semver.satisfies(candidate.version, range)) {
      throw new CliError(
        `Skill ${skillId} resolved from ${matchedBy} has version ${version}, which does not satisfy ${range}`,
        3
      );
    }
  }

  return {
    version,
    skillRoot: candidate.path
  };
}

async function collectGitSkillCandidates(repoPath: string): Promise<GitSkillCandidate[]> {
  const candidates: GitSkillCandidate[] = [];
  await walkGitSkillCandidates(repoPath, repoPath, candidates);
  candidates.sort((left, right) => left.path.localeCompare(right.path));
  return candidates;
}

async function walkGitSkillCandidates(repoPath: string, currentPath: string, candidates: GitSkillCandidate[]): Promise<void> {
  if (currentPath !== repoPath && (await isGitSkillRoot(currentPath))) {
    const metadata = await loadSkillMetadata(currentPath);
    candidates.push({
      path: currentPath,
      name: path.basename(currentPath),
      metadataId: metadata?.id,
      version: metadata?.version
    });
    return;
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (GIT_SKILL_SCAN_SKIP_DIRS.has(entry.name)) {
      continue;
    }
    await walkGitSkillCandidates(repoPath, path.join(currentPath, entry.name), candidates);
  }
}

async function isGitSkillRoot(candidatePath: string): Promise<boolean> {
  return (await exists(path.join(candidatePath, "skill.yaml"))) || (await exists(path.join(candidatePath, "SKILL.md")));
}

function splitSkillId(skillId: string): string[] {
  return skillId.replaceAll("\\", "/").split("/").filter(Boolean);
}

function selectProviderLookupLeaf(skillId: string, providerRef?: string): string {
  if (providerRef) {
    const parsed = parseCanonicalProviderSkillReference(providerRef);
    if (parsed && typeof parsed !== "string") {
      return parsed.skill;
    }
  }
  return splitSkillId(skillId).at(-1) ?? skillId;
}

export function providerKindsEqual(left?: ManifestSource["provider"], right?: ManifestSource["provider"]): boolean {
  return left?.kind === right?.kind;
}

function buildCanonicalProviderSkillReference(
  provider: CanonicalProviderSkillReference["provider"],
  owner: string,
  repo: string,
  skill: string,
  ref: string
): CanonicalProviderSkillReference | string {
  if (![owner, repo, skill].every(isCanonicalProviderSegment) || repo.endsWith(".git") || skill.endsWith(".git")) {
    return `Canonical provider refs must use plain owner/repo/skill segments. ${CANONICAL_PROVIDER_REF_USAGE}`;
  }

  return {
    provider,
    owner,
    repo,
    skill,
    ref,
    canonicalRef: `${provider}:${owner}/${repo}/${skill}`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`
  };
}

function isCanonicalProviderSegment(value: string): boolean {
  return value !== "." && value !== ".." && CANONICAL_PROVIDER_SEGMENT_PATTERN.test(value);
}

function buildGitTlsConfigArgs(): string[] {
  const caInfo = process.env.SSL_CERT_FILE || process.env.CURL_CA_BUNDLE;
  return caInfo ? ["-c", `http.sslCAInfo=${caInfo}`] : [];
}

async function cloneGitSource(
  gitTlsConfigArgs: string[],
  gitExecutionContext: IsolatedGitExecutionContext,
  sourceUrl: string,
  repoPath: string
): Promise<void> {
  try {
    await execFileAsync("git", [...gitTlsConfigArgs, ...GIT_HARDENED_CONFIG_ARGS, "clone", "--depth", "1", "--no-tags", sourceUrl, repoPath], {
      cwd: gitExecutionContext.cwd,
      env: gitExecutionContext.env
    });
    return;
  } catch (error) {
    if (!shouldRetryWithoutShallowClone(error)) {
      throw error;
    }
  }

  await execFileAsync("git", [...gitTlsConfigArgs, ...GIT_HARDENED_CONFIG_ARGS, "clone", "--no-tags", sourceUrl, repoPath], {
    cwd: gitExecutionContext.cwd,
    env: gitExecutionContext.env
  });
}

function shouldRetryWithoutShallowClone(error: unknown): boolean {
  const message = formatGitError(error).toLowerCase();
  return message.includes("dumb http transport does not support shallow capabilities");
}

interface IsolatedGitExecutionContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

async function createIsolatedGitExecutionContext(): Promise<IsolatedGitExecutionContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-git-"));
  const homeDir = path.join(tempRoot, "home");
  const xdgConfigHome = path.join(tempRoot, "xdg");
  const workDir = path.join(tempRoot, "work");
  await Promise.all([ensureDir(homeDir), ensureDir(xdgConfigHome), ensureDir(workDir)]);
  return {
    cwd: workDir,
    env: buildIsolatedGitEnv(homeDir, xdgConfigHome),
    cleanup: async () => rm(tempRoot, { recursive: true, force: true })
  };
}

function buildIsolatedGitEnv(homeDir: string, xdgConfigHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith("GIT_") || key === "HOME" || key === "XDG_CONFIG_HOME" || key === "SSH_ASKPASS") {
      continue;
    }
    env[key] = value;
  }

  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = xdgConfigHome;
  env.GIT_CONFIG_GLOBAL = path.join(homeDir, ".gitconfig");
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";
  env.SSH_ASKPASS = "";
  return env;
}

function formatGitError(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) {
    return error.stderr.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
