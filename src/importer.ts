import path from "node:path";
import { readdir } from "node:fs/promises";
import { CliError } from "./errors";
import { createDefaultManifest, loadManifest } from "./manifest";
import { loadSkillMetadata } from "./skill";
import type { ManifestSkill, SkillsManifest, TargetType } from "./types";
import { exists, normalizeRelativePath, printInfo, printWarning } from "./utils";
import { resolveDefaultTargetPath } from "./adapter";

const SKIP_SCAN_DIRS = new Set([".git", ".skills", "dist", "node_modules", "vendor"]);

interface ScanRoot {
  label: string;
  path: string;
}

export interface ImportResult {
  manifest: SkillsManifest;
  importedCount: number;
  warningCount: number;
}

export async function importSkills(cwd: string, from?: string): Promise<ImportResult> {
  const manifest = (await exists(path.join(cwd, "skills.yaml"))) ? await loadManifest(cwd) : createDefaultManifest(path.basename(cwd));
  const scanRoots = await resolveScanRoots(cwd, from);
  const discovered = new Map<string, ManifestSkill>();
  let warningCount = 0;

  for (const scanRoot of scanRoots) {
    printInfo(`Scanning ${scanRoot.label}...`);
    for (const skill of await discoverSkillEntries(cwd, scanRoot.path)) {
      if (!skill.version) {
        warningCount += 1;
      }
      if (!discovered.has(skill.id) && !manifest.skills.some((entry) => entry.id === skill.id)) {
        discovered.set(skill.id, skill);
      }
    }
  }

  if (warningCount > 0) {
    printWarning(`${warningCount} imported skill${warningCount === 1 ? "" : "s"} have no version metadata`);
  }

  const nextSkills = [...manifest.skills, ...[...discovered.values()].sort((left, right) => left.id.localeCompare(right.id))];
  return {
    manifest: {
      ...manifest,
      skills: nextSkills
    },
    importedCount: discovered.size,
    warningCount
  };
}

async function resolveScanRoots(cwd: string, from?: string): Promise<ScanRoot[]> {
  if (from) {
    return [await resolveExplicitScanRoot(cwd, from)];
  }

  const roots: ScanRoot[] = [{ label: "cwd", path: cwd }];
  const openclawPath = resolveDefaultTargetPath("openclaw");
  if (openclawPath && (await exists(openclawPath)) && path.resolve(openclawPath) !== path.resolve(cwd)) {
    roots.push({ label: "openclaw", path: openclawPath });
  }
  return roots;
}

async function resolveExplicitScanRoot(cwd: string, from: string): Promise<ScanRoot> {
  if (from === "openclaw" || from === "codex" || from === "claude_code") {
    const targetPath = resolveDefaultTargetPath(from as TargetType);
    if (!targetPath || !(await exists(targetPath))) {
      throw new CliError(`Default ${from} skills directory was not found.`, 2);
    }
    return { label: from, path: targetPath };
  }

  const resolvedPath = path.resolve(cwd, from);
  if (!(await exists(resolvedPath))) {
    throw new CliError(`Import path does not exist: ${from}`, 2);
  }
  return {
    label: normalizeRelativePath(cwd, resolvedPath),
    path: resolvedPath
  };
}

async function discoverSkillEntries(cwd: string, rootPath: string): Promise<ManifestSkill[]> {
  const discovered = new Map<string, ManifestSkill>();
  await walkForSkills(cwd, rootPath, discovered);
  return [...discovered.values()];
}

async function walkForSkills(cwd: string, currentPath: string, discovered: Map<string, ManifestSkill>): Promise<void> {
  if (await isSkillRoot(currentPath)) {
    const skill = await createManifestSkill(cwd, currentPath);
    if (!discovered.has(skill.id)) {
      discovered.set(skill.id, skill);
    }
    return;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (SKIP_SCAN_DIRS.has(entry.name)) {
      continue;
    }
    if (entry.name.startsWith(".") && path.resolve(currentPath) === path.resolve(cwd)) {
      continue;
    }
    await walkForSkills(cwd, path.join(currentPath, entry.name), discovered);
  }
}

async function isSkillRoot(candidatePath: string): Promise<boolean> {
  return (await exists(path.join(candidatePath, "skill.yaml"))) || (await exists(path.join(candidatePath, "SKILL.md")));
}

async function createManifestSkill(cwd: string, skillRoot: string): Promise<ManifestSkill> {
  const metadata = await loadSkillMetadata(skillRoot);
  const skillId = metadata?.id ?? `local/${path.basename(skillRoot)}`;
  const skill: ManifestSkill = {
    id: skillId,
    path: normalizeRelativePath(cwd, skillRoot)
  };

  if (metadata?.version) {
    skill.version = metadata.version;
  }

  return skill;
}
