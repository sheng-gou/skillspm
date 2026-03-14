import path from "node:path";
import { rm } from "node:fs/promises";
import { CliError } from "./errors";
import { loadLockfile } from "./lockfile";
import { PACK_MANIFEST_FILE, PACK_SKILLS_DIR } from "./pack";
import type { ScopeLayout } from "./scope";
import type { SkillsPack } from "./types";
import { buildInstalledEntryName, copyDir, ensureDir, exists, isDirectory, writeYamlDocument } from "./utils";

export interface PackProjectResult {
  outDir: string;
  pack: SkillsPack;
}

export async function packProject(layout: ScopeLayout, outDir: string): Promise<PackProjectResult> {
  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    throw new CliError("No skills.lock found. Run `skillspm install` first.", 2);
  }
  if (!(await exists(layout.installedRoot)) || !(await isDirectory(layout.installedRoot))) {
    throw new CliError("No installed skills found. Run `skillspm install` first.", 2);
  }

  await rm(outDir, { recursive: true, force: true });
  await ensureDir(path.join(outDir, PACK_SKILLS_DIR));

  const resolved = {} as SkillsPack["resolved"];
  for (const [skillId, node] of Object.entries(lockfile.resolved).sort(([left], [right]) => left.localeCompare(right))) {
    const entryName = buildInstalledEntryName(skillId, node.version);
    const sourcePath = path.join(layout.installedRoot, entryName);
    if (!(await isDirectory(sourcePath))) {
      throw new CliError(`Installed files for ${skillId}@${node.version} are missing: ${sourcePath}`, 4);
    }

    await copyDir(sourcePath, path.join(outDir, PACK_SKILLS_DIR, entryName));
    resolved[skillId] = {
      version: node.version,
      source: node.source,
      dependencies: node.dependencies ?? []
    };
  }

  const pack: SkillsPack = {
    schema: "skills-pack/v1",
    generated_at: new Date().toISOString(),
    resolved
  };
  await writeYamlDocument(path.join(outDir, PACK_MANIFEST_FILE), pack);

  return {
    outDir,
    pack
  };
}
