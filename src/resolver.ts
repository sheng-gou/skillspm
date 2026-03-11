import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import { loadIndex, findMatchingIndexVersion, resolveIndexArtifactRoot } from "./index-source";
import { loadManifest } from "./manifest";
import { loadSkillMetadata, validateSkillMetadata } from "./skill";
import type {
  ManifestSkill,
  ManifestSource,
  ResolutionResult,
  ResolvedSkillNode,
  SkillDependency
} from "./types";
import {
  assertConfiguredPathWithinRootReal,
  assertSkillRootMarker,
  exists,
  isDirectory,
  readDocument,
  resolveFileUrlOrPath
} from "./utils";

interface ResolveContext {
  cwd: string;
  nodes: Map<string, ResolvedSkillNode>;
  rootSkillIds: string[];
  rootLookup: Map<string, ManifestSkill>;
  sourceLookup: Map<string, ManifestSource>;
}

export async function resolveProject(cwd: string): Promise<ResolutionResult> {
  const manifest = await loadManifest(cwd);
  const rootLookup = new Map<string, ManifestSkill>(manifest.skills.map((skill) => [skill.id, skill]));
  const sourceLookup = new Map<string, ManifestSource>((manifest.sources ?? []).map((source) => [source.name, source]));
  const context: ResolveContext = {
    cwd,
    nodes: new Map(),
    rootSkillIds: manifest.skills.map((skill) => skill.id),
    rootLookup,
    sourceLookup
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
  chain: string[]
): Promise<void> {
  if (manifestSkill.path) {
    await resolvePathSkill(context, manifestSkill, manifestSkill.path, isRoot, chain);
    return;
  }

  const source = selectSource(context, manifestSkill);
  if (source.type !== "index") {
    throw new CliError(`Source ${source.name} uses unsupported type ${source.type}. MVP install only supports index sources.`, 3);
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
  const node: ResolvedSkillNode = {
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
    root: isRoot
  };
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
  chain: string[]
): Promise<void> {
  const explicitRoot = context.rootLookup.get(dependency.id);
  if (explicitRoot?.path) {
    await resolveManifestSkill(context, explicitRoot, false, chain);
    ensureDependencyRange(explicitRoot.id, context.nodes.get(explicitRoot.id)?.version, dependency.version, chain);
    return;
  }

  const manifestSkill: ManifestSkill = explicitRoot
    ? {
        ...explicitRoot,
        source: explicitRoot.source ?? inheritedSource?.name
      }
    : {
    id: dependency.id,
    version: dependency.version,
    source: inheritedSource?.name
  };
  await resolveManifestSkill(context, manifestSkill, false, chain);
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

  const indexSources = [...context.sourceLookup.values()].filter((source) => source.type === "index");
  if (indexSources.length === 1) {
    return indexSources[0];
  }

  throw new CliError(`Skill ${manifestSkill.id} must declare source because there is not exactly one index source`, 2);
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
