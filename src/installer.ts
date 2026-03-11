import path from "node:path";
import { writeLockfile } from "./lockfile";
import { resolveProject } from "./resolver";
import type { SkillsLock } from "./types";
import { copyDir, ensureDir, printInfo, printSuccess, sanitizeSkillId } from "./utils";

export async function installProject(cwd: string): Promise<SkillsLock> {
  printInfo("Resolving dependencies...");
  const resolution = await resolveProject(cwd);
  printSuccess(`Resolved ${resolution.nodes.size} skill${resolution.nodes.size === 1 ? "" : "s"}`);

  const installedRoot = path.join(cwd, ".skills", "installed");
  await ensureDir(installedRoot);

  printInfo("Installing...");
  for (const node of [...resolution.nodes.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const targetDir = path.join(installedRoot, `${sanitizeSkillId(node.id)}@${node.version}`);
    await copyDir(node.installPath, targetDir);
    printSuccess(`Installed ${node.id}@${node.version}`);
  }

  const resolvedEntries = [...resolution.nodes.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .reduce<SkillsLock["resolved"]>((accumulator, node) => {
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
  return lockfile;
}
