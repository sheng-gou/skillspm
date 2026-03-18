import path from "node:path";
import { rm } from "node:fs/promises";
import semver from "semver";
import { CliError } from "./errors";
import { loadLibrary, resolveCachedSkillPath, selectCachedVersion } from "./library";
import { verifyLockedSkillPathIdentity } from "./lockfile";
import { loadLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import { loadSkillMetadata } from "./skill";
import {
  buildRecordedProviderLibrarySource,
  getPublicGitHubProjectFallbackFailureReason,
  getLockedProviderRefForLibrarySource,
  inferPublicGitHubLockfileSourceCandidates,
  inferPublicGitHubProjectSourceCandidates,
  materializeProviderSource,
  selectPublicProviderProjectVersion,
  supportsPublicProviderRecoverySkillId
} from "./provider";
import type { LoadedPack } from "./pack";
import type {
  LibrarySkillSource,
  LockedSkillEntry,
  LockedSkillResolvedFrom,
  ManifestSkill,
  ResolutionResult,
  ResolvedSkillNode,
  SkillDependency,
  SkillsLock,
  SkillsManifest
} from "./types";
import { assertSkillRootMarker, exists, hashDirectoryContents, isDirectory } from "./utils";
import { resolveScopeLayout } from "./scope";

function buildUnsupportedProviderRecoveryFailureReason(skillId: string): string {
  return `provider recovery is only supported for explicit public provider skill ids (github:, openclaw:, clawhub:, skills.sh:); requested ${skillId}`;
}

interface ResolveContext {
  cwd: string;
  manifest: SkillsManifest;
  lockfile?: SkillsLock;
  pack?: LoadedPack;
  nodes: Map<string, ResolvedSkillNode>;
  rootLookup: Map<string, ManifestSkill>;
  rootSkillIds: string[];
  library: Awaited<ReturnType<typeof loadLibrary>>;
}

interface MaterializedSkillResolution {
  applicable?: boolean;
  installPath?: string;
  failureReason?: string;
  digest?: string;
  resolvedFrom?: LockedSkillResolvedFrom;
  source?: LibrarySkillSource;
}

export interface ResolveProjectOptions {
  manifest?: SkillsManifest;
  lockfile?: SkillsLock;
  pack?: LoadedPack;
}

export async function resolveProject(cwd: string, options: ResolveProjectOptions = {}): Promise<ResolutionResult> {
  const manifest = options.manifest ?? await loadManifest(cwd);
  const lockfile = options.lockfile ?? await loadLockfile(cwd);
  const layout = resolveScopeLayout(cwd);
  const context: ResolveContext = {
    cwd,
    manifest,
    lockfile,
    pack: options.pack,
    nodes: new Map(),
    rootLookup: new Map(manifest.skills.map((skill) => [skill.id, skill])),
    rootSkillIds: manifest.skills.map((skill) => skill.id),
    library: await loadLibrary(layout)
  };

  for (const rootSkill of manifest.skills) {
    await resolveManifestSkill(context, rootSkill, true, []);
  }

  return {
    manifest,
    lockfile,
    nodes: context.nodes,
    rootSkillIds: context.rootSkillIds
  };
}

async function resolveManifestSkill(
  context: ResolveContext,
  manifestSkill: ManifestSkill,
  isRoot: boolean,
  chain: string[]
): Promise<void> {
  const version = await selectSkillVersion(context, manifestSkill, chain);
  const materialized = await resolveMaterializedSkillPath(context, manifestSkill.id, version);
  if (!materialized.installPath) {
    throw new CliError(
      `Unable to materialize ${manifestSkill.id}@${version}: cache lookup failed: not present in the machine-local library cache; source resolution failed: ${materialized.failureReason ?? "no reusable source provenance recorded"}.`,
      3
    );
  }

  const installPath = materialized.installPath;
  if (!(await exists(installPath)) || !(await isDirectory(installPath))) {
    throw new CliError(`Resolved skill path is missing for ${manifestSkill.id}@${version}: ${installPath}`, 4);
  }
  await assertSkillRootMarker(installPath, `Skill ${manifestSkill.id}@${version}`);

  const metadata = await loadSkillMetadata(installPath);
  const resolvedId = metadata?.id ?? manifestSkill.id;
  const resolvedVersion = metadata?.version ?? version;
  ensureMatchingId(manifestSkill.id, resolvedId);
  ensureVersionConsistency(manifestSkill.id, version, resolvedVersion);

  const node: ResolvedSkillNode = {
    id: resolvedId,
    version: resolvedVersion,
    digest: materialized.digest!,
    resolvedFrom: materialized.resolvedFrom!,
    ...(materialized.source ? { source: materialized.source } : {}),
    dependencies: metadata?.dependencies ?? [],
    installPath,
    metadata,
    root: isRoot
  };
  await registerNode(context, node, manifestSkill.version, chain);

  for (const dependency of node.dependencies) {
    await resolveDependency(context, dependency, [...chain, node.id]);
  }
}

async function resolveDependency(context: ResolveContext, dependency: SkillDependency, chain: string[]): Promise<void> {
  const explicitRoot = context.rootLookup.get(dependency.id);
  const manifestSkill: ManifestSkill = explicitRoot
    ? explicitRoot
    : {
        id: dependency.id,
        ...(dependency.version ? { version: dependency.version } : {})
      };
  await resolveManifestSkill(context, manifestSkill, false, chain);
  ensureDependencyRange(dependency.id, context.nodes.get(dependency.id)?.version, dependency.version, chain);
}

async function selectSkillVersion(context: ResolveContext, manifestSkill: ManifestSkill, chain: string[]): Promise<string> {
  const requested = manifestSkill.version;

  if (requested && isExactVersion(requested)) {
    return requested;
  }

  const lockedVersion = context.lockfile?.skills[manifestSkill.id]?.version;
  if (lockedVersion && satisfiesRequestedVersion(lockedVersion, requested)) {
    return lockedVersion;
  }

  const packedVersion = context.pack?.manifest.skills[manifestSkill.id]?.version;
  if (packedVersion && satisfiesRequestedVersion(packedVersion, requested)) {
    return packedVersion;
  }

  const cachedVersion = selectCachedVersion(context.library, manifestSkill.id, requested);
  if (cachedVersion) {
    return cachedVersion;
  }

  const providerVersion = await selectPublicProviderProjectVersion(manifestSkill.id, requested);
  if (providerVersion) {
    return providerVersion;
  }

  const via = chain.length > 0 ? ` via ${chain.join(" -> ")}` : "";
  throw new CliError(
    `Unable to resolve an exact version for ${manifestSkill.id}${requested ? ` (${requested})` : ""}${via}. No matching version was found in skills.lock, the provided pack, recorded library metadata, or supported public provider metadata. Freeze exact versions, install from a pack, or add/adopt a source that can be materialized locally first.`,
    3
  );
}

async function resolveMaterializedSkillPath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<MaterializedSkillResolution> {
  const layout = resolveScopeLayout(context.cwd);
  const lockEntry = context.lockfile?.skills[skillId];
  const cachedPath = await resolveCachedSkillPath(layout, context.library, skillId, version);
  if (cachedPath) {
    const digest = await verifyLockedPath(skillId, version, lockEntry, cachedPath, "Cached materialized content");
    return {
      installPath: cachedPath,
      digest,
      resolvedFrom: getCachedResolvedFrom(context, skillId, version)
    };
  }

  const sourceFailures: string[] = [];
  const packPath = context.pack?.manifest.skills[skillId];
  if (packPath && packPath.version === version) {
    const candidate = path.join(context.pack.skillsDir, packPath.entry);
    if (await exists(candidate)) {
      const digest = await verifyLockedPath(skillId, version, lockEntry, candidate, "Pack materialized content");
      return {
        installPath: candidate,
        digest,
        resolvedFrom: {
          type: "pack",
          ref: packPath.entry
        }
      };
    }
    sourceFailures.push(`pack entry was declared but missing at ${candidate}`);
  }

  const recordedPathSource = await resolveRecordedPathSourcePath(context, skillId, version);
  if (recordedPathSource.installPath) {
    return recordedPathSource;
  }
  if (recordedPathSource.failureReason) {
    sourceFailures.push(recordedPathSource.failureReason);
  }

  const lockedProviderSource = await resolveLockedProviderSourcePath(context, skillId, version);
  if (lockedProviderSource.installPath) {
    return lockedProviderSource;
  }
  if (lockedProviderSource.applicable) {
    return {
      failureReason: sourceFailures.length > 0
        ? [...sourceFailures, lockedProviderSource.failureReason ?? "locked provider provenance is insufficient for public github recovery"].join("; ")
        : lockedProviderSource.failureReason ?? "locked provider provenance is insufficient for public github recovery"
    };
  }

  const recordedProviderSource = await resolveRecordedLibraryProviderSourcePath(context, skillId, version);
  if (recordedProviderSource.installPath) {
    return recordedProviderSource;
  }
  if (recordedProviderSource.failureReason) {
    sourceFailures.push(recordedProviderSource.failureReason);
  }

  const recordedLibrarySource = context.library.skills[skillId]?.versions[version]?.source;
  const projectFallbackFailure = getPublicGitHubProjectFallbackFailureReason(recordedLibrarySource);
  if (projectFallbackFailure) {
    return {
      failureReason: sourceFailures.length > 0 ? sourceFailures.join("; ") : projectFallbackFailure
    };
  }

  const projectSource = await resolvePublicGitHubProjectSourcePath(context, skillId, version);
  if (projectSource.installPath) {
    return projectSource;
  }
  if (projectSource.failureReason) {
    sourceFailures.push(projectSource.failureReason);
  }

  return {
    failureReason: sourceFailures.length > 0 ? sourceFailures.join("; ") : "no reusable source provenance recorded"
  };
}

async function resolveLockedProviderSourcePath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<MaterializedSkillResolution> {
  const lockEntry = context.lockfile?.skills[skillId];
  if (lockEntry?.resolved_from?.type === "provider" && !supportsPublicProviderRecoverySkillId(skillId)) {
    return {
      applicable: true,
      failureReason: buildUnsupportedProviderRecoveryFailureReason(skillId)
    };
  }

  const candidates = inferPublicGitHubLockfileSourceCandidates(lockEntry?.resolved_from, version);
  if (!candidates.applicable) {
    return {
      applicable: false
    };
  }
  if (!candidates.sources || candidates.sources.length === 0) {
    return {
      applicable: true,
      failureReason: candidates.failureReason ?? "locked provider provenance is insufficient for public github recovery"
    };
  }

  const layout = resolveScopeLayout(context.cwd);
  const failures: string[] = [];
  for (const source of candidates.sources) {
    const materialized = await materializeProviderSource(layout, skillId, version, source);
    if (!materialized.installPath) {
      failures.push(materialized.failureReason ?? `public github recovery failed for ${source.value}`);
      continue;
    }

    try {
      const digest = await verifyLockedPath(skillId, version, lockEntry, materialized.installPath, "Locked provider materialized content");
      const recoveredSource = buildRecordedProviderLibrarySource(skillId, materialized.materializedSource ?? source);
      return {
        applicable: true,
        installPath: materialized.installPath,
        digest,
        resolvedFrom: {
          type: "provider",
          ref: source.value
        },
        source: recoveredSource
      };
    } catch (error) {
      await rm(materialized.installPath, { recursive: true, force: true });
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    applicable: true,
    failureReason: failures.length > 0
      ? failures.join("; ")
      : candidates.failureReason ?? "locked provider provenance is insufficient for public github recovery"
  };
}

async function resolveRecordedPathSourcePath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<MaterializedSkillResolution> {
  const source = context.library.skills[skillId]?.versions[version]?.source;
  if (!source) {
    return {
      failureReason: "no reusable source provenance recorded"
    };
  }

  if (source.kind === "provider") {
    return {};
  }

  if (!(await exists(source.value))) {
    return {
      failureReason: `recorded ${source.kind} source path no longer exists: ${source.value}`
    };
  }

  if (!(await isDirectory(source.value))) {
    return {
      failureReason: `recorded ${source.kind} source path is not a directory: ${source.value}`
    };
  }

  try {
    await assertSkillRootMarker(source.value, `Recorded ${source.kind} source for ${skillId}@${version}`);
  } catch (error) {
    return {
      failureReason: error instanceof Error ? error.message : `recorded ${source.kind} source is not a valid skill root`
    };
  }

  const lockEntry = context.lockfile?.skills[skillId];
  const digest = await verifyLockedPath(skillId, version, lockEntry, source.value, "Recorded source materialized content");
  return {
    installPath: source.value,
    digest,
    resolvedFrom: {
      type: source.kind,
      ref: source.value
    },
    source
  };
}

async function resolveRecordedLibraryProviderSourcePath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<MaterializedSkillResolution> {
  const source = context.library.skills[skillId]?.versions[version]?.source;
  if (!source || source.kind !== "provider") {
    return {};
  }

  if (!supportsPublicProviderRecoverySkillId(skillId)) {
    return {
      failureReason: buildUnsupportedProviderRecoveryFailureReason(skillId)
    };
  }

  const layout = resolveScopeLayout(context.cwd);
  const materialized = await materializeProviderSource(layout, skillId, version, source);
  if (!materialized.installPath) {
    return {
      failureReason: materialized.failureReason
    };
  }

  try {
    const lockEntry = context.lockfile?.skills[skillId];
    const digest = await verifyLockedPath(skillId, version, lockEntry, materialized.installPath, "Recorded provider materialized content");
    const recoveredSource = source.provider?.name === "github" && !source.provider.ref
      ? materialized.materializedSource ?? source
      : buildRecordedProviderLibrarySource(skillId, materialized.materializedSource ?? source);
    return {
      installPath: materialized.installPath,
      digest,
      resolvedFrom: {
        type: "provider",
        ref: source.value
      },
      source: recoveredSource
    };
  } catch (error) {
    await rm(materialized.installPath, { recursive: true, force: true });
    throw error;
  }
}

async function resolvePublicGitHubProjectSourcePath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<MaterializedSkillResolution> {
  const candidates = await inferPublicGitHubProjectSourceCandidates(skillId, version);
  if (!candidates.applicable) {
    return {};
  }
  if (!candidates.sources || candidates.sources.length === 0) {
    return {
      failureReason: candidates.failureReason ?? "persisted project semantics are insufficient for public github recovery"
    };
  }

  const layout = resolveScopeLayout(context.cwd);
  const lockEntry = context.lockfile?.skills[skillId];
  const failures: string[] = [];
  for (const source of candidates.sources) {
    const materialized = await materializeProviderSource(layout, skillId, version, source);
    if (!materialized.installPath) {
      failures.push(materialized.failureReason ?? `public github recovery failed for ${source.value}`);
      continue;
    }

    try {
      const digest = await verifyLockedPath(skillId, version, lockEntry, materialized.installPath, "Public github materialized content");
      return {
        installPath: materialized.installPath,
        digest,
        resolvedFrom: {
          type: "provider",
          ref: source.value
        },
        source: buildRecordedProviderLibrarySource(skillId, materialized.materializedSource ?? source)
      };
    } catch (error) {
      await rm(materialized.installPath, { recursive: true, force: true });
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    failureReason: failures.length > 0
      ? failures.join("; ")
      : candidates.failureReason ?? "persisted project semantics are insufficient for public github recovery"
  };
}

async function registerNode(
  context: ResolveContext,
  node: ResolvedSkillNode,
  requestedRange: string | undefined,
  chain: string[]
): Promise<void> {
  const existing = context.nodes.get(node.id);
  if (existing) {
    ensureDependencyRange(node.id, existing.version, requestedRange, chain);
    if (existing.version !== node.version) {
      throw new CliError(buildConflictMessage(node.id, existing.version, node.version, chain), 3);
    }
    existing.root = existing.root || node.root;
    return;
  }

  ensureDependencyRange(node.id, node.version, requestedRange, chain);
  context.nodes.set(node.id, node);
}

function isExactVersion(value: string): boolean {
  return value === "unversioned" || semver.valid(value) === value;
}

function satisfiesRequestedVersion(resolvedVersion: string, requestedRange: string | undefined): boolean {
  if (!requestedRange || resolvedVersion === "unversioned") {
    return true;
  }
  if (requestedRange === "unversioned") {
    return resolvedVersion === "unversioned";
  }
  if (semver.valid(requestedRange) === requestedRange) {
    return requestedRange === resolvedVersion;
  }
  return semver.satisfies(resolvedVersion, requestedRange);
}

function getCachedResolvedFrom(context: ResolveContext, skillId: string, version: string): LockedSkillResolvedFrom {
  const source = context.library.skills[skillId]?.versions[version]?.source;
  if (source?.kind === "provider") {
    const providerRef = supportsPublicProviderRecoverySkillId(skillId)
      ? getLockedProviderRefForLibrarySource(source)
      : undefined;
    if (providerRef) {
      return {
        type: "provider",
        ref: providerRef
      };
    }
    return {
      type: "cache",
      ref: `${skillId}@${version}`
    };
  }

  if (source) {
    return {
      type: source.kind,
      ref: source.value
    };
  }
  return {
    type: "cache",
    ref: `${skillId}@${version}`
  };
}


async function verifyLockedPath(
  skillId: string,
  version: string,
  lockEntry: LockedSkillEntry | undefined,
  targetPath: string,
  label: string
): Promise<string> {
  if (!lockEntry) {
    return hashDirectoryContents(targetPath);
  }
  if (lockEntry.version !== version) {
    return hashDirectoryContents(targetPath);
  }
  return verifyLockedSkillPathIdentity(skillId, lockEntry, targetPath, label);
}

function ensureDependencyRange(
  skillId: string,
  resolvedVersion: string | undefined,
  requestedRange: string | undefined,
  chain: string[]
): void {
  if (!requestedRange || !resolvedVersion || resolvedVersion === "unversioned") {
    return;
  }
  if (requestedRange === "unversioned") {
    if (resolvedVersion !== "unversioned") {
      throw new CliError(buildRangeConflictMessage(skillId, resolvedVersion, requestedRange, chain), 3);
    }
    return;
  }
  if (semver.valid(requestedRange) === requestedRange) {
    if (resolvedVersion !== requestedRange) {
      throw new CliError(buildRangeConflictMessage(skillId, resolvedVersion, requestedRange, chain), 3);
    }
    return;
  }
  if (!semver.satisfies(resolvedVersion, requestedRange)) {
    throw new CliError(buildRangeConflictMessage(skillId, resolvedVersion, requestedRange, chain), 3);
  }
}

function buildRangeConflictMessage(
  skillId: string,
  resolvedVersion: string,
  requestedRange: string,
  chain: string[]
): string {
  const fromChain = chain.length > 0 ? `${chain.join(" -> ")} -> ${skillId}` : skillId;
  return `Dependency conflict detected for ${skillId}: resolved ${resolvedVersion} does not satisfy ${requestedRange} requested by ${fromChain}`;
}

function buildConflictMessage(skillId: string, currentVersion: string, newVersion: string, chain: string[]): string {
  const detail = chain.length > 0 ? ` via ${chain.join(" -> ")}` : "";
  return `Dependency conflict detected for ${skillId}: ${currentVersion} vs ${newVersion}${detail}`;
}

function ensureMatchingId(requestedId: string, resolvedId: string): void {
  if (requestedId !== resolvedId) {
    throw new CliError(`Skill id mismatch: requested ${requestedId} but resolved ${resolvedId}`, 3);
  }
}

function ensureVersionConsistency(skillId: string, expectedVersion: string, resolvedVersion: string): void {
  if (expectedVersion !== resolvedVersion) {
    throw new CliError(`Skill ${skillId} expected version ${expectedVersion} but metadata resolved ${resolvedVersion}`, 3);
  }
}
