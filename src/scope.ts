import os from "node:os";
import path from "node:path";

export type SkillsScope = "project" | "global";

export interface ScopeLayout {
  scope: SkillsScope;
  rootDir: string;
  cacheDir: string;
  libraryFile: string;
  librarySkillsDir: string;
}

export function resolveScopeLayout(cwd: string, useGlobal = false): ScopeLayout {
  const cacheDir = path.join(os.homedir(), ".skillspm");
  return {
    scope: useGlobal ? "global" : "project",
    rootDir: useGlobal ? path.join(cacheDir, "global") : cwd,
    cacheDir,
    libraryFile: path.join(cacheDir, "library.yaml"),
    librarySkillsDir: path.join(cacheDir, "skills")
  };
}

export function formatScopeLabel(scope: SkillsScope): string {
  return scope === "global" ? "global (~/.skillspm/global)" : "project";
}
