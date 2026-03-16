import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadLibrary, resolveCachedSkillPath } from "./library";
import { loadLockfile } from "./lockfile";
import { verifyLockedSkillPathIdentity } from "./lockfile";
import { loadManifest } from "./manifest";
import { PACK_INTERNAL_MANIFEST_FILE, PACK_SKILLS_DIR } from "./pack";
import type { ScopeLayout } from "./scope";
import type { SkillsPackManifest } from "./types";
import { copyDir, ensureDir, printSuccess, writeYamlDocument } from "./utils";
import { CliError } from "./errors";

const execFileAsync = promisify(execFile);

export interface PackProjectResult {
  outFile: string;
}

export async function packProject(layout: ScopeLayout, outFile: string): Promise<PackProjectResult> {
  const manifest = await loadManifest(layout.rootDir);
  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    throw new CliError("No skills.lock found. Run `skillspm install` or `skillspm freeze` first.", 2);
  }

  const packedManifest = {
    skills: manifest.skills.map((skill) => ({
      id: skill.id,
      ...(lockfile.skills[skill.id] ? { version: lockfile.skills[skill.id].version } : skill.version ? { version: skill.version } : {})
    })),
    ...(manifest.targets ? { targets: manifest.targets } : {})
  };

  const library = await loadLibrary(layout);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-pack-build-"));

  try {
    await ensureDir(path.join(tempRoot, PACK_SKILLS_DIR));
    await ensureDir(path.dirname(outFile));
    await writeYamlDocument(path.join(tempRoot, "skills.yaml"), packedManifest);
    await writeYamlDocument(path.join(tempRoot, "skills.lock"), lockfile);

    const packManifest: SkillsPackManifest = {
      schema: "skills-pack-manifest/v1",
      generated_at: new Date().toISOString(),
      skills: {}
    };

    for (const [skillId, entry] of Object.entries(lockfile.skills).sort(([left], [right]) => left.localeCompare(right))) {
      const version = entry.version;
      const sourcePath = await resolveCachedSkillPath(layout, library, skillId, version);
      if (!sourcePath) {
        throw new CliError(`Cached files for ${skillId}@${version} are missing from ${layout.librarySkillsDir}.`, 4);
      }
      await verifyLockedSkillPathIdentity(skillId, entry, sourcePath, "Cached materialized content");

      const entryName = path.basename(sourcePath);
      await copyDir(sourcePath, path.join(tempRoot, PACK_SKILLS_DIR, entryName), { dereference: true });
      packManifest.skills[skillId] = {
        version,
        entry: entryName
      };
    }

    await writeYamlDocument(path.join(tempRoot, PACK_INTERNAL_MANIFEST_FILE), packManifest);
    await execFileAsync("tar", ["-czf", outFile, "-C", tempRoot, "."]);
    printSuccess(`Wrote ${outFile}`);
    return { outFile };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
