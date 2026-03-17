import { cacheSkill, loadLibrary } from "./library";
import { buildLockfileFromNodes, writeLockfile } from "./lockfile";
import type { LoadedPack } from "./pack";
import { resolveProject } from "./resolver";
import type { ScopeLayout } from "./scope";
import type { SkillsLock, SkillsManifest } from "./types";
import { printInfo, printSuccess } from "./utils";

export interface InstallProjectResult {
  lockfile: SkillsLock;
  manifest: SkillsManifest;
}

export interface InstallProjectOptions {
  manifest?: SkillsManifest;
  lockfile?: SkillsLock;
  pack?: LoadedPack;
  writeLockfile?: boolean;
}

export async function installProject(layout: ScopeLayout, options: InstallProjectOptions = {}): Promise<InstallProjectResult> {
  printInfo("Resolving dependencies...");
  const resolution = await resolveProject(layout.rootDir, {
    manifest: options.manifest,
    lockfile: options.lockfile,
    pack: options.pack
  });
  printSuccess(`Resolved ${resolution.nodes.size} skill${resolution.nodes.size === 1 ? "" : "s"}`);

  const library = await loadLibrary(layout);
  printInfo("Caching skills...");
  for (const node of [...resolution.nodes.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    await cacheSkill(layout, library, node.id, node.version, node.installPath, node.source);
    printSuccess(`Cached ${node.id}@${node.version}`);
  }

  const lockfile: SkillsLock = buildLockfileFromNodes(resolution.nodes.values());

  if (options.writeLockfile !== false) {
    await writeLockfile(layout.rootDir, lockfile);
    printSuccess("Updated skills.lock");
  }

  return {
    lockfile,
    manifest: resolution.manifest
  };
}
