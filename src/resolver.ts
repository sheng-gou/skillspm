import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import { findMatchingGitSkillVersion, loadGitSource } from "./git-source";
import { loadIndex, findMatchingIndexVersion, resolveIndexArtifactRoot } from "./index-source";
import { loadManifest } from "./manifest";
import { PACK_SKILLS_DIR, findPackNode, loadManifestPacks } from "./pack";
import { loadSkillMetadata, validateSkillMetadata } from "./skill";
import type {
  ManifestSkill,
  ManifestSource,
  SkillsManifest,
  ResolutionResult,
  ResolvedSkillNode,
  SkillDependency
} from "./types";
import {
  assertConfiguredPathWithinRootReal,
  assertSkillRootMarker,
  buildInstalledEntryName,
  exists,
  isDirectory,
  readDocument,
  resolveFileUrlOrPath
} from "./utils";
import type { LoadedGitSource } from "./git-source";
import type { LoadedPack } from "./pack";

interface ResolveContext {
  cwd: string;
  nodes: Map<string, ResolvedSkillNode>;
  rootSkillIds: string[];
  rootLookup: Map<string, ManifestSkill>;
  sourceLookup: Map<string, ManifestSource>;
  packs: LoadedPack[];
  gitSourceLookup: Map<string, LoadedGitSource>;
  gitCacheRoot: string;
}

export interface ResolveProjectOptions {
  manifest?: SkillsManifest;
  stateDir?: string;
}

export async function resolveProject(cwd: string, options: ResolveProjectOptions = {}): Promise<ResolutionResult> {
  const manifest = options.manifest ?? await loadManifest(cwd);
  const rootLookup = new Map<string, ManifestSkill>(manifest.skills.map((skill) => [skill.id, skill]));
  const sourceLookup = new Map<string, ManifestSource>((manifest.sources ?? []).map((source) => [source.name, source]));
  const context: ResolveContext = {
    cwd,
    nodes: new Map(),
    rootSkillIds: manifest.skills.map((skill) => skill.id),
    rootLookup,
    sourceLookup,
    packs: await loadManifestPacks(cwd, manifest),
    gitSourceLookup: new Map(),
    gitCacheRoot: path.join(options.stateDir ?? path.join(cwd, ".skills"), "sources", "git")
  };

  for (const rootSkill of manifest.skills) {
    await resolveManifestSkill(context, rootSkill, true, []);
  }

  return {
    manifest,
    nodes: context.nodes,
    rootSkillIds: context.rootSkillIds
  };
}

async function resolveManifestSkill(
  context: ResolveContext,
  manifestSkill: ManifestSkill,
  isRoot: boolean,
  chain: string[],
  preferredPack?: LoadedPack
): Promise<void> {
  if (manifestSkill.path) {
    await resolvePathSkill(context, manifestSkill, manifestSkill.path, isRoot, chain);
    return;
  }

  const exactVersion = getExactVersion(manifestSkill.version);
  if (!manifestSkill.source) {
    if (preferredPack && exactVersion) {
      const preferredNode = preferredPack.manifest.resolved[manifestSkill.id];
      if (preferredNode?.version === exactVersion) {
        await resolvePackSkill(context, preferredPack, manifestSkill.id, exactVersion, isRoot, chain);
        return;
      }
    }
    if (exactVersion) {
      const packNode = await findPackNode(context.packs, manifestSkill.id, exactVersion);
      if (packNode) {
        await resolvePackSkill(context, packNode.pack, manifestSkill.id, exactVersion, isRoot, chain);
        return;
      }
    }
  }

  const source = selectSource(context, manifestSkill);
  if (source.type === "git") {
    await resolveGitSkill(context, manifestSkill, source, isRoot, chain, preferredPack);
    return;
  }
  if (source.type !== "index") {
    throw new CliError(`Source ${source.name} uses unsupported type ${source.type}.`, 3);
  }

  const { index, indexPath } = await loadIndex(source.url, context.cwd);
  const skillEntry = index.skills?.find((entry) => entry.id === manifestSkill.id);
  if (!skillEntry) {
    throw new CliError(`Skill ${manifestSkill.id} was not found in source ${source.name}`, 3);
  }
  const { version, entry } = findMatchingIndexVersion(index, manifestSkill.id, manifestSkill.version);
  const artifactRoot = resolveIndexArtifactRoot(indexPath, skillEntry, version, entry);
  if (entry.artifact?.url) {
    await assertConfiguredPathWithinRootReal(
      context.cwd,
      entry.artifact.url,
      artifactRoot,
      `artifact path for ${manifestSkill.id}@${version}`
    );
  }
  const metadataPath = entry.metadata?.path
    ? resolveFileUrlOrPath(artifactRoot, entry.metadata.path)
    : path.join(artifactRoot, "skill.yaml");
  if (entry.metadata?.path) {
    await assertConfiguredPathWithinRootReal(
      artifactRoot,
      entry.metadata.path,
      metadataPath,
      `metadata path for ${manifestSkill.id}@${version}`
    );
  }

  if (!(await isDirectory(artifactRoot))) {
    throw new CliError(`Artifact path for ${manifestSkill.id}@${version} does not exist: ${artifactRoot}`, 4);
  }
  await assertSkillRootMarker(artifactRoot, `Skill ${manifestSkill.id}@${version}`);

  const metadata = await loadSkillMetadataFromExplicitPath(artifactRoot, metadataPath);
  const dependencies = metadata?.dependencies ?? [];
  const node = await maybeApplyPackMaterialization(context, manifestSkill.version, preferredPack, {
    id: metadata?.id ?? manifestSkill.id,
    version,
    dependencies,
    installPath: artifactRoot,
    metadata,
    source: {
      type: "index",
      name: source.name,
      url: source.url
    },
    artifact: {
      type: "path",
      url: artifactRoot
    },
    materialization: {
      type: "live",
      path: artifactRoot
    },
    root: isRoot
  });
  ensureMatchingId(manifestSkill.id, node.id);

  await registerNode(context, node, manifestSkill.version, chain);

  for (const dependency of dependencies) {
    await resolveDependency(context, dependency, source, [...chain, node.id]);
  }
}

async function resolveGitSkill(
  context: ResolveContext,
  manifestSkill: ManifestSkill,
  source: ManifestSource,
  isRoot: boolean,
  chain: string[],
  preferredPack?: LoadedPack
): Promise<void> {
  const loadedSource = await getLoadedGitSource(context, source);
  const { version, skillRoot } = await findMatchingGitSkillVersion(loadedSource.path, manifestSkill.id, manifestSkill.version);
  if (!(await isDirectory(skillRoot))) {
    throw new CliError(`Git skill path for ${manifestSkill.id}@${version} does not exist: ${skillRoot}`, 4);
  }
  await assertSkillRootMarker(skillRoot, `Skill ${manifestSkill.id}@${version}`);

  const metadata = await loadSkillMetadata(skillRoot);
  if (metadata?.version && metadata.version !== version) {
    throw new CliError(`Resolved skill ${manifestSkill.id}@${version} metadata version does not match repo layout version ${version}`, 3);
  }
  const dependencies = metadata?.dependencies ?? [];
  const node = await maybeApplyPackMaterialization(context, manifestSkill.version, preferredPack, {
    id: metadata?.id ?? manifestSkill.id,
    version,
    dependencies,
    installPath: skillRoot,
    metadata,
    source: {
      type: "git",
      name: source.name,
      url: source.url,
      revision: loadedSource.revision
    },
    artifact: {
      type: "path",
      url: skillRoot
    },
    materialization: {
      type: "live",
      path: skillRoot
    },
    root: isRoot
  });
  ensureMatchingId(manifestSkill.id, node.id);

  await registerNode(context, node, manifestSkill.version, chain);

  for (const dependency of dependencies) {
    await resolveDependency(context, dependency, source, [...chain, node.id]);
  }
}

async function resolvePathSkill(
  context: ResolveContext,
  manifestSkill: ManifestSkill,
  configuredPath: string,
  isRoot: boolean,
  chain: string[]
): Promise<void> {
  const absolutePath = resolveFileUrlOrPath(context.cwd, configuredPath);
  await assertConfiguredPathWithinRootReal(
    context.cwd,
    configuredPath,
    absolutePath,
    `local skill path for ${manifestSkill.id}`
  );
  if (!(await exists(absolutePath))) {
    throw new CliError(`Local skill path for ${manifestSkill.id} does not exist: ${configuredPath}`, 4);
  }
  if (!(await isDirectory(absolutePath))) {
    throw new CliError(`Local skill path for ${manifestSkill.id} is not a directory: ${configuredPath}`, 4);
  }
  await assertSkillRootMarker(absolutePath, `Skill ${manifestSkill.id}`);

  const metadata = await loadSkillMetadata(absolutePath);
  const resolvedId = metadata?.id ?? manifestSkill.id;
  const version = metadata?.version ?? "unversioned";
  const node: ResolvedSkillNode = {
    id: resolvedId,
    version,
    dependencies: metadata?.dependencies ?? [],
    installPath: absolutePath,
    metadata,
    source: {
      type: "path",
      url: absolutePath
    },
    artifact: {
      type: "path",
      url: absolutePath
    },
    materialization: {
      type: "live",
      path: absolutePath
    },
    root: isRoot
  };
  ensureMatchingId(manifestSkill.id, node.id);

  await registerNode(context, node, manifestSkill.version, chain);

  for (const dependency of node.dependencies) {
    const inheritedSource = manifestSkill.source ? context.sourceLookup.get(manifestSkill.source) : undefined;
    await resolveDependency(context, dependency, inheritedSource, [...chain, node.id]);
  }
}

async function resolveDependency(
  context: ResolveContext,
  dependency: SkillDependency,
  inheritedSource: ManifestSource | undefined,
  chain: string[],
  preferredPack?: LoadedPack
): Promise<void> {
  const explicitRoot = context.rootLookup.get(dependency.id);
  if (explicitRoot?.path) {
    await resolveManifestSkill(context, explicitRoot, false, chain, preferredPack);
    ensureDependencyRange(explicitRoot.id, context.nodes.get(explicitRoot.id)?.version, dependency.version, chain);
    return;
  }

  const manifestSkill: ManifestSkill = explicitRoot
    ? {
        ...explicitRoot,
        version: explicitRoot.version ?? dependency.version,
        source: explicitRoot.source ?? inheritedSource?.name
      }
    : {
    id: dependency.id,
    version: dependency.version,
    source: inheritedSource?.name
  };
  await resolveManifestSkill(context, manifestSkill, false, chain, preferredPack);
  ensureDependencyRange(manifestSkill.id, context.nodes.get(manifestSkill.id)?.version, dependency.version, chain);
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

function ensureDependencyRange(
  skillId: string,
  resolvedVersion: string | undefined,
  requestedRange: string | undefined,
  chain: string[]
): void {
  if (!requestedRange || !resolvedVersion || resolvedVersion === "unversioned") {
    return;
  }
  if (!semver.satisfies(resolvedVersion, requestedRange)) {
    const fromChain = chain.length > 0 ? `${chain.join(" -> ")} -> ${skillId}` : skillId;
    throw new CliError(
      `Dependency conflict detected for ${skillId}: resolved ${resolvedVersion} does not satisfy ${requestedRange} requested by ${fromChain}`,
      3
    );
  }
}

function buildConflictMessage(skillId: string, currentVersion: string, newVersion: string, chain: string[]): string {
  const detail = chain.length > 0 ? ` via ${chain.join(" -> ")}` : "";
  return `Dependency conflict detected for ${skillId}: ${currentVersion} vs ${newVersion}${detail}`;
}

function selectSource(context: ResolveContext, manifestSkill: ManifestSkill): ManifestSource {
  if (manifestSkill.source) {
    const source = context.sourceLookup.get(manifestSkill.source);
    if (!source) {
      throw new CliError(`Unknown source ${manifestSkill.source} for ${manifestSkill.id}`, 2);
    }
    return source;
  }

  const sources = [...context.sourceLookup.values()];
  if (sources.length === 1) {
    return sources[0];
  }

  throw new CliError(`Skill ${manifestSkill.id} must declare source because there is not exactly one configured source`, 2);
}

async function loadSkillMetadataFromExplicitPath(skillRoot: string, metadataPath: string) {
  if (!(await exists(metadataPath))) {
    return undefined;
  }
  if (path.dirname(metadataPath) === skillRoot && path.basename(metadataPath) === "skill.yaml") {
    return loadSkillMetadata(skillRoot);
  }
  const raw = await readDocument<unknown>(metadataPath);
  return validateSkillMetadata(raw, metadataPath);
}

function ensureMatchingId(requestedId: string, resolvedId: string): void {
  if (requestedId !== resolvedId) {
    throw new CliError(`Resolved skill id mismatch: requested ${requestedId} but metadata declares ${resolvedId}`, 3);
  }
}

async function maybeApplyPackMaterialization(
  context: ResolveContext,
  requestedRange: string | undefined,
  preferredPack: LoadedPack | undefined,
  node: ResolvedSkillNode
): Promise<ResolvedSkillNode> {
  const exactVersion = getExactVersion(requestedRange);
  if (!exactVersion || exactVersion !== node.version || !node.source) {
    return node;
  }

  const packCandidate = await findCompatiblePackMaterialization(context, preferredPack, node.id, node.version, node.source);
  if (!packCandidate) {
    return node;
  }

  await assertSkillRootMarker(packCandidate.installPath, `Packed skill ${node.id}@${node.version}`);
  const metadata = await loadSkillMetadata(packCandidate.installPath);
  ensureMatchingId(node.id, metadata?.id ?? node.id);

  return {
    ...node,
    installPath: packCandidate.installPath,
    materialization: {
      type: "pack",
      pack: packCandidate.pack.name,
      path: packCandidate.pack.path,
      entry: path.join(PACK_SKILLS_DIR, buildInstalledEntryName(node.id, node.version))
    }
  };
}

async function findCompatiblePackMaterialization(
  context: ResolveContext,
  preferredPack: LoadedPack | undefined,
  skillId: string,
  version: string,
  selectedSource: NonNullable<ResolvedSkillNode["source"]>
) {
  const candidatePacks = preferredPack
    ? [preferredPack, ...context.packs.filter((pack) => pack !== preferredPack)]
    : context.packs;

  for (const pack of candidatePacks) {
    const packNode = await findPackNode([pack], skillId, version);
    if (!packNode) {
      continue;
    }
    if (!isPackSourceCompatible(selectedSource, packNode.node.source)) {
      continue;
    }
    return packNode;
  }

  return undefined;
}

function isPackSourceCompatible(
  selectedSource: NonNullable<ResolvedSkillNode["source"]>,
  packSource: ResolvedSkillNode["source"] | undefined
): boolean {
  if (!packSource) {
    return false;
  }
  if (selectedSource.type !== packSource.type) {
    return false;
  }
  if (selectedSource.url !== packSource.url) {
    return false;
  }
  if (selectedSource.type === "git") {
    return Boolean(selectedSource.revision) && selectedSource.revision === packSource.revision;
  }
  return true;
}

async function resolvePackSkill(
  context: ResolveContext,
  pack: LoadedPack,
  skillId: string,
  version: string,
  isRoot: boolean,
  chain: string[]
): Promise<void> {
  const packNode = pack.manifest.resolved[skillId];
  if (!packNode || packNode.version !== version) {
    throw new CliError(`Pack ${pack.name} does not contain ${skillId}@${version}`, 3);
  }

  const installPath = path.join(pack.path, PACK_SKILLS_DIR, buildInstalledEntryName(skillId, version));
  if (!(await isDirectory(installPath))) {
    throw new CliError(`Pack ${pack.name} is missing files for ${skillId}@${version}: ${installPath}`, 4);
  }
  await assertSkillRootMarker(installPath, `Packed skill ${skillId}@${version}`);

  const metadata = await loadSkillMetadata(installPath);
  const dependencies = resolvePackDependencies(pack, skillId, packNode.dependencies ?? []);
  const node: ResolvedSkillNode = {
    id: metadata?.id ?? skillId,
    version,
    dependencies,
    installPath,
    metadata,
    source: packNode.source,
    artifact: {
      type: "path",
      url: installPath
    },
    materialization: {
      type: "pack",
      pack: pack.name,
      path: pack.path,
      entry: path.join(PACK_SKILLS_DIR, buildInstalledEntryName(skillId, version))
    },
    root: isRoot
  };
  ensureMatchingId(skillId, node.id);

  await registerNode(context, node, version, chain);

  for (const dependency of dependencies) {
    await resolveDependency(context, dependency, undefined, [...chain, node.id], pack);
  }
}

function resolvePackDependencies(pack: LoadedPack, skillId: string, dependencyIds: string[]): SkillDependency[] {
  return dependencyIds.map((dependencyId) => {
    const dependencyNode = pack.manifest.resolved[dependencyId];
    if (!dependencyNode) {
      throw new CliError(`Pack ${pack.name} is missing dependency metadata for ${skillId} -> ${dependencyId}`, 3);
    }
    return {
      id: dependencyId,
      version: dependencyNode.version
    };
  });
}

async function getLoadedGitSource(context: ResolveContext, source: ManifestSource): Promise<LoadedGitSource> {
  const existing = context.gitSourceLookup.get(source.name);
  if (existing) {
    return existing;
  }
  const loaded = await loadGitSource(context.gitCacheRoot, source);
  context.gitSourceLookup.set(source.name, loaded);
  return loaded;
}

function getExactVersion(range: string | undefined): string | undefined {
  return range && semver.valid(range) === range ? range : undefined;
}
