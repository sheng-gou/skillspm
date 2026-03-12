import path from "node:path";
import { writeLockfile } from "./lockfile";
import { resolveProject } from "./resolver";
import { resolveStateContainmentRoot } from "./scope";
import type { ScopeLayout } from "./scope";
import type { SkillsLock, SkillsManifest } from "./types";
import {
  buildInstalledEntryName,
  copyDir,
  ensureDir,
  printInfo,
  printSuccess,
  removeStaleRootEntries,
  resolveCleanupRoot
} from "./utils";

export interface InstallProjectResult {
  lockfile: SkillsLock;
  manifest: SkillsManifest;
}

export async function installProject(layout: ScopeLayout): Promise<InstallProjectResult> {
  printInfo("Resolving dependencies...");
  const resolution = await resolveProject(layout.rootDir);
  printSuccess(`Resolved ${resolution.nodes.size} skill${resolution.nodes.size === 1 ? "" : "s"}`);

  await resolveCleanupRoot(layout.installedRoot, {
    containmentRoot: resolveStateContainmentRoot(layout),
    label: `cleanup root ${layout.installedRoot}`
  });
  await ensureDir(layout.installedRoot);
  const sortedNodes = [...resolution.nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const desiredEntries = sortedNodes.map((node) => buildInstalledEntryName(node.id, node.version));

  printInfo("Installing...");
  for (const node of sortedNodes) {
    const targetDir = path.join(layout.installedRoot, buildInstalledEntryName(node.id, node.version));
    await copyDir(node.installPath, targetDir);
    printSuccess(`Installed ${node.id}@${node.version}`);
  }
  await removeStaleRootEntries(layout.installedRoot, desiredEntries, {
    containmentRoot: resolveStateContainmentRoot(layout),
    label: `cleanup root ${layout.installedRoot}`
  });

  const resolvedEntries = sortedNodes.reduce<SkillsLock["resolved"]>((accumulator, node) => {
    accumulator[node.id] = {
      version: node.version,
      source: node.source,
      artifact: node.artifact,
      dependencies: node.dependencies.map((dependency) => dependency.id)
    };
    return accumulator;
  }, {});

  const lockfile: SkillsLock = {
    schema: "skills-lock/v1",
    project: resolution.manifest.project,
    resolved: resolvedEntries,
    generated_at: new Date().toISOString()
  };

  await writeLockfile(layout.rootDir, lockfile);
  printSuccess("Updated skills.lock");
  return {
    lockfile,
    manifest: resolution.manifest
  };
}
