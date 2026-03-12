import path from "node:path";
import { writeLockfile } from "./lockfile";
import { resolveProject } from "./resolver";
import type { SkillsLock, SkillsManifest } from "./types";
import {
  copyDir,
  ensureDir,
  printInfo,
  printSuccess,
  removeStaleRootEntries,
  resolveCleanupRoot,
  sanitizeInstalledSkillVersion,
  sanitizeSkillId
} from "./utils";

export interface InstallProjectResult {
  lockfile: SkillsLock;
  manifest: SkillsManifest;
}

export async function installProject(cwd: string): Promise<InstallProjectResult> {
  printInfo("Resolving dependencies...");
  const resolution = await resolveProject(cwd);
  printSuccess(`Resolved ${resolution.nodes.size} skill${resolution.nodes.size === 1 ? "" : "s"}`);

  const installedRoot = path.join(cwd, ".skills", "installed");
  await ensureDir(installedRoot);
  await resolveCleanupRoot(installedRoot, {
    containmentRoot: cwd,
    label: `cleanup root ${installedRoot}`
  });
  const sortedNodes = [...resolution.nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const desiredEntries = sortedNodes.map((node) => installedEntryName(node.id, node.version));

  printInfo("Installing...");
  for (const node of sortedNodes) {
    const targetDir = path.join(installedRoot, installedEntryName(node.id, node.version));
    await copyDir(node.installPath, targetDir);
    printSuccess(`Installed ${node.id}@${node.version}`);
  }
  await removeStaleRootEntries(installedRoot, desiredEntries, {
    containmentRoot: cwd,
    label: `cleanup root ${installedRoot}`
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

  await writeLockfile(cwd, lockfile);
  printSuccess("Updated skills.lock");
  return {
    lockfile,
    manifest: resolution.manifest
  };
}

function installedEntryName(skillId: string, version: string): string {
  return `${sanitizeSkillId(skillId)}@${sanitizeInstalledSkillVersion(version)}`;
}
