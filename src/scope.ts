import os from "node:os";
import path from "node:path";

export type SkillsScope = "project" | "global";

export interface ScopeLayout {
  scope: SkillsScope;
  rootDir: string;
  stateDir: string;
  installedRoot: string;
  importedRoot: string;
}

export function resolveScopeLayout(cwd: string, useGlobal = false): ScopeLayout {
  const rootDir = useGlobal ? path.join(os.homedir(), ".skills") : cwd;
  const stateDir = useGlobal ? rootDir : path.join(rootDir, ".skills");

  return {
    scope: useGlobal ? "global" : "project",
    rootDir,
    stateDir,
    installedRoot: path.join(stateDir, "installed"),
    importedRoot: path.join(stateDir, "imported")
  };
}

export function formatScopeLabel(scope: SkillsScope): string {
  return scope === "global" ? "global (~/.skills)" : "project";
}

export function resolveStateContainmentRoot(layout: ScopeLayout): string {
  return layout.scope === "global" ? layout.stateDir : layout.rootDir;
}
