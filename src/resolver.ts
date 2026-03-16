import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import { loadLibrary, resolveCachedSkillPath, selectCachedVersion } from "./library";
import { loadLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import { loadSkillMetadata } from "./skill";
import type { LoadedPack } from "./pack";
import type { ManifestSkill, ResolutionResult, ResolvedSkillNode, SkillDependency, SkillsLock, SkillsManifest } from "./types";
import { assertSkillRootMarker, exists, isDirectory } from "./utils";
import { resolveScopeLayout } from "./scope";

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
  const version = selectSkillVersion(context, manifestSkill, chain);
  const installPath = await resolveCachedOrPackedSkillPath(context, manifestSkill.id, version);
  if (!installPath) {
    throw new CliError(`Skill ${manifestSkill.id}@${version} is not available in the local library cache.`, 3);
  }

  if (!(await exists(installPath)) || !(await isDirectory(installPath))) {
    throw new CliError(`Cached skill path is missing for ${manifestSkill.id}@${version}: ${installPath}`, 4);
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

function selectSkillVersion(context: ResolveContext, manifestSkill: ManifestSkill, chain: string[]): string {
  const requested = manifestSkill.version;

  if (requested && isExactVersion(requested)) {
    return requested;
  }

  const lockedVersion = context.lockfile?.skills[manifestSkill.id];
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

  const via = chain.length > 0 ? ` via ${chain.join(" -> ")}` : "";
  throw new CliError(
    `Unable to resolve ${manifestSkill.id}${requested ? ` (${requested})` : ""}${via}. Cache it with \`skillspm add <content>\`, install from a pack, or freeze exact versions first.`,
    3
  );
}

async function resolveCachedOrPackedSkillPath(
  context: ResolveContext,
  skillId: string,
  version: string
): Promise<string | undefined> {
  const packPath = context.pack?.manifest.skills[skillId];
  if (packPath && packPath.version === version) {
    const candidate = path.join(context.pack.skillsDir, packPath.entry);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  const layout = resolveScopeLayout(context.cwd);
  return resolveCachedSkillPath(layout, context.library, skillId, version);
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
