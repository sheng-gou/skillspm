import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadLibrary, resolveCachedSkillPath } from "./library";
import { loadLockfile, verifyLockedSkillPathIdentity } from "./lockfile";
import { loadManifest } from "./manifest";
import { PACK_INTERNAL_MANIFEST_FILE, PACK_SKILLS_DIR } from "./pack";
import type { ScopeLayout } from "./scope";
import { getConfirmedStateRequirementError, inspectProjectState, isConfirmedProjectState } from "./state";
import type { LibrarySkillSource, SkillsPackManifest } from "./types";
import { copyDir, ensureDir, printSuccess, writeYamlDocument } from "./utils";
import { CliError } from "./errors";

const execFileAsync = promisify(execFile);

export interface PackProjectResult {
  outFile: string;
}

export async function packProject(layout: ScopeLayout, outFile: string): Promise<PackProjectResult> {
  const snapshot = await inspectProjectState(layout);
  if (!isConfirmedProjectState(snapshot)) {
    throw new CliError(getConfirmedStateRequirementError(snapshot, "pack") ?? "Pack requires a confirmed project state.", 2);
  }

  const manifest = await loadManifest(layout.rootDir);
  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    throw new CliError("No skills.lock found. Run `skillspm install` or `skillspm freeze` first.", 2);
  }

  const library = await loadLibrary(layout);
  const manifestSourceLookup = new Map(manifest.skills.map((skill) => [skill.id, skill.source]));
  const packedManifest = {
    skills: manifest.skills.map((skill) => {
      const locked = lockfile.skills[skill.id];
      const persistedSource = resolvePackedSource(skill.source, locked ? library.skills[skill.id]?.versions[locked.version]?.source : undefined);
      return {
        id: skill.id,
        ...(locked ? { version: locked.version } : skill.version ? { version: skill.version } : {}),
        ...(persistedSource ? { source: persistedSource } : {})
      };
    }),
    ...(manifest.targets ? { targets: manifest.targets } : {})
  };

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
      const persistedSource = resolvePackedSource(manifestSourceLookup.get(skillId), library.skills[skillId]?.versions[version]?.source);
      packManifest.skills[skillId] = {
        version,
        entry: entryName,
        ...(persistedSource ? { source: persistedSource } : {})
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

function resolvePackedSource(primary?: LibrarySkillSource, fallback?: LibrarySkillSource): LibrarySkillSource | undefined {
  return primary ?? fallback;
}
