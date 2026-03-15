import path from "node:path";
import { CliError } from "./errors";
import type { ManifestPack, LockResolvedNode, SkillsManifest, SkillsPack } from "./types";
import {
  assertConfiguredPathWithinRootReal,
  buildInstalledEntryName,
  exists,
  isDirectory,
  readDocument,
  resolveFileUrlOrPath
} from "./utils";

export const PACK_MANIFEST_FILE = "pack.yaml";
export const PACK_SKILLS_DIR = "skills";

export interface LoadedPack {
  name: string;
  path: string;
  manifest: SkillsPack;
}

export interface LoadedPackNode {
  pack: LoadedPack;
  node: LockResolvedNode;
  installPath: string;
}

export async function loadManifestPacks(cwd: string, manifest: SkillsManifest): Promise<LoadedPack[]> {
  const loaded: LoadedPack[] = [];
  for (const pack of manifest.packs ?? []) {
    loaded.push(await loadPack(cwd, pack));
  }
  return loaded;
}

export async function loadPack(cwd: string, pack: ManifestPack): Promise<LoadedPack> {
  const packPath = resolveFileUrlOrPath(cwd, pack.path);
  await assertConfiguredPathWithinRootReal(cwd, pack.path, packPath, `pack path ${pack.name}`);
  if (!(await isDirectory(packPath))) {
    throw new CliError(`Pack ${pack.name} does not exist or is not a directory: ${pack.path}`, 4);
  }

  const manifestPath = path.join(packPath, PACK_MANIFEST_FILE);
  if (!(await exists(manifestPath))) {
    throw new CliError(`Pack ${pack.name} is missing ${PACK_MANIFEST_FILE}: ${pack.path}`, 4);
  }

  return {
    name: pack.name,
    path: packPath,
    manifest: validatePackManifest(await readDocument<unknown>(manifestPath), manifestPath)
  };
}

export async function findPackNode(packs: LoadedPack[], skillId: string, version: string): Promise<LoadedPackNode | undefined> {
  for (const pack of packs) {
    const node = pack.manifest.resolved[skillId];
    if (!node || node.version !== version) {
      continue;
    }

    const installPath = path.join(pack.path, PACK_SKILLS_DIR, buildInstalledEntryName(skillId, version));
    if (!(await isDirectory(installPath))) {
      throw new CliError(`Pack ${pack.name} is missing files for ${skillId}@${version}: ${installPath}`, 4);
    }

    return {
      pack,
      node,
      installPath
    };
  }
  return undefined;
}

function validatePackManifest(raw: unknown, sourceLabel: string): SkillsPack {
  const value = raw as Partial<SkillsPack>;
  const errors: string[] = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`Invalid pack manifest in ${sourceLabel}: expected YAML object`, 2);
  }
  if (value.schema !== "skills-pack/v1") {
    errors.push("schema must be skills-pack/v1");
  }
  if (typeof value.generated_at !== "string") {
    errors.push("generated_at must be a string");
  }
  if (!value.resolved || typeof value.resolved !== "object" || Array.isArray(value.resolved)) {
    errors.push("resolved must be an object");
  }

  for (const [skillId, node] of Object.entries(value.resolved ?? {})) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`resolved.${skillId} must be an object`);
      continue;
    }
    if (typeof node.version !== "string") {
      errors.push(`resolved.${skillId}.version must be a string`);
    }
    if (node.dependencies !== undefined && (!Array.isArray(node.dependencies) || node.dependencies.some((dependency) => typeof dependency !== "string"))) {
      errors.push(`resolved.${skillId}.dependencies must be an array of strings`);
    }
    if (node.source !== undefined && (typeof node.source !== "object" || node.source === null || Array.isArray(node.source))) {
      errors.push(`resolved.${skillId}.source must be an object`);
    } else if (node.source) {
      if (node.source.type !== "index" && node.source.type !== "git" && node.source.type !== "path") {
        errors.push(`resolved.${skillId}.source.type has unsupported value`);
      }
      if (node.source.name !== undefined && typeof node.source.name !== "string") {
        errors.push(`resolved.${skillId}.source.name must be a string`);
      }
      if (node.source.url !== undefined && typeof node.source.url !== "string") {
        errors.push(`resolved.${skillId}.source.url must be a string`);
      }
      if (node.source.revision !== undefined && typeof node.source.revision !== "string") {
        errors.push(`resolved.${skillId}.source.revision must be a string`);
      }
      if (node.source.provider !== undefined && (typeof node.source.provider !== "object" || node.source.provider === null || Array.isArray(node.source.provider))) {
        errors.push(`resolved.${skillId}.source.provider must be an object`);
      } else if (node.source.provider) {
        if (node.source.type !== "git") {
          errors.push(`resolved.${skillId}.source.provider is only supported for git sources`);
        }
        if (node.source.provider.kind !== "skills.sh" && node.source.provider.kind !== "clawhub") {
          errors.push(`resolved.${skillId}.source.provider.kind must be skills.sh or clawhub`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new CliError(`Invalid pack manifest in ${sourceLabel}:\n- ${errors.join("\n- ")}`, 2);
  }

  return value as SkillsPack;
}
