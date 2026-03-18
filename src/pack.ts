import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError } from "./errors";
import { loadLockfileFromPath } from "./lockfile";
import { loadManifestFromPath } from "./manifest";
import type { SkillsLock, SkillsManifest, SkillsPackManifest } from "./types";
import { assertPathWithinRootReal, exists, isDirectory, readDocument } from "./utils";

const execFileAsync = promisify(execFile);

export const PACK_INTERNAL_MANIFEST_FILE = "manifest.yaml";
export const PACK_SKILLS_DIR = "skills";

export interface LoadedPack {
  rootDir: string;
  manifestFile: string;
  manifest: SkillsPackManifest;
  skillsManifest: SkillsManifest;
  lockfile: SkillsLock;
  skillsDir: string;
  cleanup: () => Promise<void>;
}

export async function extractPack(packPath: string): Promise<LoadedPack> {
  if (!(await exists(packPath))) {
    throw new CliError(`Pack file does not exist: ${packPath}`, 2);
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-pack-"));
  try {
    await execFileAsync("tar", ["-xzf", packPath, "-C", tempRoot]);
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw new CliError(`Unable to extract pack ${packPath}: ${error instanceof Error ? error.message : String(error)}`, 2);
  }

  const manifestFile = path.join(tempRoot, PACK_INTERNAL_MANIFEST_FILE);
  const skillsManifestFile = path.join(tempRoot, "skills.yaml");
  const lockfilePath = path.join(tempRoot, "skills.lock");
  const skillsDir = path.join(tempRoot, PACK_SKILLS_DIR);
  if (!(await exists(manifestFile))) {
    await rm(tempRoot, { recursive: true, force: true });
    throw new CliError(`Pack is missing ${PACK_INTERNAL_MANIFEST_FILE}: ${packPath}`, 2);
  }
  if (!(await isDirectory(skillsDir))) {
    await rm(tempRoot, { recursive: true, force: true });
    throw new CliError(`Pack is missing ${PACK_SKILLS_DIR}/: ${packPath}`, 2);
  }

  try {
    await validateExtractedPackFiles(tempRoot, {
      manifestFile,
      skillsManifestFile,
      lockfilePath,
      skillsDir
    });
    await validateExtractedSkillsTree(skillsDir);
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  try {
    const manifest = validatePackManifest(await readDocument<unknown>(manifestFile), manifestFile);
    await validatePackEntries(skillsDir, manifest);
    const skillsManifest = await loadManifestFromPath(skillsManifestFile);
    const lockfile = await loadLockfileFromPath(lockfilePath);
    if (!lockfile) {
      throw new CliError(`Pack is missing skills.lock: ${packPath}`, 2);
    }

    return {
      rootDir: tempRoot,
      manifestFile,
      manifest,
      skillsManifest,
      lockfile,
      skillsDir,
      cleanup: async () => {
        await rm(tempRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function validatePackManifest(value: unknown, sourceLabel: string): SkillsPackManifest {
  const raw = value as Partial<SkillsPackManifest>;
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError(`Invalid pack manifest in ${sourceLabel}: expected YAML object`, 2);
  }
  if (raw.schema !== "skills-pack-manifest/v1") {
    errors.push("schema must be skills-pack-manifest/v1");
  }
  if (typeof raw.generated_at !== "string") {
    errors.push("generated_at must be a string");
  }
  if (!raw.skills || typeof raw.skills !== "object" || Array.isArray(raw.skills)) {
    errors.push("skills must be an object");
  }

  for (const [skillId, entry] of Object.entries(raw.skills ?? {})) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`skills.${skillId} must be an object`);
      continue;
    }
    if (typeof entry.version !== "string") {
      errors.push(`skills.${skillId}.version must be a string`);
    }
    if (typeof entry.entry !== "string") {
      errors.push(`skills.${skillId}.entry must be a string`);
    }
    if ("source" in entry && entry.source !== undefined) {
      if (!entry.source || typeof entry.source !== "object" || Array.isArray(entry.source)) {
        errors.push(`skills.${skillId}.source must be an object`);
      } else {
        const source = entry.source as { kind?: unknown; value?: unknown; provider?: unknown };
        if (typeof source.kind !== "string") {
          errors.push(`skills.${skillId}.source.kind must be a string`);
        } else if (!["local", "target", "provider"].includes(source.kind)) {
          errors.push(`skills.${skillId}.source.kind must be one of: local, target, provider`);
        }
        if (typeof source.value !== "string") {
          errors.push(`skills.${skillId}.source.value must be a string`);
        }
        if ("provider" in source && source.provider !== undefined) {
          if (!source.provider || typeof source.provider !== "object" || Array.isArray(source.provider)) {
            errors.push(`skills.${skillId}.source.provider must be an object`);
          } else {
            const provider = source.provider as { name?: unknown; ref?: unknown; visibility?: unknown };
            if (typeof provider.name !== "string") {
              errors.push(`skills.${skillId}.source.provider.name must be a string`);
            }
            if ("ref" in provider && provider.ref !== undefined && typeof provider.ref !== "string") {
              errors.push(`skills.${skillId}.source.provider.ref must be a string`);
            }
            if ("visibility" in provider && provider.visibility !== undefined && typeof provider.visibility !== "string") {
              errors.push(`skills.${skillId}.source.provider.visibility must be a string`);
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new CliError(`Invalid pack manifest in ${sourceLabel}:\n- ${errors.join("\n- ")}`, 2);
  }

  return raw as SkillsPackManifest;
}

async function validateExtractedPackFiles(
  tempRoot: string,
  paths: {
    manifestFile: string;
    skillsManifestFile: string;
    lockfilePath: string;
    skillsDir: string;
  }
): Promise<void> {
  await assertPathWithinRootReal(tempRoot, paths.manifestFile, `pack file ${PACK_INTERNAL_MANIFEST_FILE}`);
  await assertPathWithinRootReal(tempRoot, paths.skillsManifestFile, "pack file skills.yaml");
  await assertPathWithinRootReal(tempRoot, paths.lockfilePath, "pack file skills.lock");
  await assertPathWithinRootReal(tempRoot, paths.skillsDir, `pack directory ${PACK_SKILLS_DIR}/`);
}

async function validateExtractedSkillsTree(skillsDir: string): Promise<void> {
  const queue = [skillsDir];
  const visitedDirectories = new Set<string>();

  while (queue.length > 0) {
    const currentDir = queue.shift()!;
    const currentInfo = await stat(currentDir);
    if (!currentInfo.isDirectory()) {
      throw new CliError(`Pack payload directory is invalid: ${currentDir}`, 2);
    }

    const resolvedCurrentDir = await realpath(currentDir);
    if (visitedDirectories.has(resolvedCurrentDir)) {
      continue;
    }
    visitedDirectories.add(resolvedCurrentDir);

    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      await assertPathWithinRootReal(
        skillsDir,
        entryPath,
        `pack payload entry ${path.relative(skillsDir, entryPath) || entry.name}`
      );

      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const entryInfo = await stat(entryPath);
      if (entryInfo.isDirectory()) {
        queue.push(entryPath);
      }
    }
  }
}

async function validatePackEntries(skillsDir: string, manifest: SkillsPackManifest): Promise<void> {
  for (const [skillId, entry] of Object.entries(manifest.skills)) {
    if (!entry.entry.trim()) {
      throw new CliError(`Invalid pack manifest entry for ${skillId}: entry must not be empty`, 2);
    }
    if (path.isAbsolute(entry.entry)) {
      throw new CliError(`Invalid pack manifest entry for ${skillId}: absolute paths are not allowed`, 2);
    }

    const candidate = path.resolve(skillsDir, entry.entry);
    await assertPathWithinRootReal(skillsDir, candidate, `pack manifest entry for ${skillId}`);
    if (!(await exists(candidate)) || !(await isDirectory(candidate))) {
      throw new CliError(`Pack payload is missing directory for ${skillId}: ${entry.entry}`, 2);
    }
  }
}
