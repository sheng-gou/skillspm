import path from "node:path";
import { readdir } from "node:fs/promises";
import { cacheSkill, loadLibrary } from "./library";
import { CliError } from "./errors";
import { resolveDefaultTargetPath } from "./adapter";
import { createDefaultManifest, loadManifest } from "./manifest";
import type { ScopeLayout } from "./scope";
import { loadSkillMetadata } from "./skill";
import type { LibrarySkillSource, ManifestSkill, SkillsManifest, TargetType } from "./types";
import { assertSkillRootMarker, exists, printInfo, printWarning } from "./utils";

const SKIP_SCAN_DIRS = new Set([".git", ".skillspm", ".skills", "dist", "node_modules", "vendor"]);

interface ScanRoot {
  label: string;
  path: string;
  sourceKind: "local" | "target";
}

interface DiscoveredSkillEntry {
  manifestSkill: ManifestSkill;
  skillRoot: string;
  hasVersion: boolean;
  source: LibrarySkillSource;
}

export interface ImportResult {
  manifest: SkillsManifest;
  importedCount: number;
  warningCount: number;
}

export async function importSkills(layout: ScopeLayout, commandCwd: string, source?: string): Promise<ImportResult> {
  const manifest = (await exists(path.join(layout.rootDir, "skills.yaml")))
    ? await loadManifest(layout.rootDir)
    : createDefaultManifest();
  const scanRoots = await resolveScanRoots(commandCwd, source);
  const discovered = new Map<string, ManifestSkill>();
  const library = await loadLibrary(layout);
  let warningCount = 0;

  for (const scanRoot of scanRoots) {
    printInfo(`Scanning ${scanRoot.label}...`);
    for (const skill of await discoverSkillEntries(layout.rootDir, scanRoot)) {
      if (!skill.hasVersion) {
        warningCount += 1;
      }
      if (!discovered.has(skill.manifestSkill.id) && !manifest.skills.some((entry) => entry.id === skill.manifestSkill.id)) {
        await cacheSkill(layout, library, skill.manifestSkill.id, skill.manifestSkill.version ?? "unversioned", skill.skillRoot, skill.source);
        discovered.set(skill.manifestSkill.id, skill.manifestSkill);
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

async function resolveScanRoots(cwd: string, source?: string): Promise<ScanRoot[]> {
  if (source) {
    return resolveExplicitScanRoots(cwd, source);
  }

  const roots: ScanRoot[] = [{ label: "cwd", path: cwd, sourceKind: "local" }];
  const openclawPath = resolveDefaultTargetPath("openclaw");
  if (openclawPath && (await exists(openclawPath)) && path.resolve(openclawPath) !== path.resolve(cwd)) {
    roots.push({ label: "openclaw", path: openclawPath, sourceKind: "target" });
  }
  return roots;
}

async function resolveExplicitScanRoots(cwd: string, source: string): Promise<ScanRoot[]> {
  const values = [...new Set(source.split(",").map((entry) => entry.trim()).filter(Boolean))];
  if (values.length === 0) {
    throw new CliError("Adopt source must not be empty.", 2);
  }

  const roots = await Promise.all(values.map((value) => resolveExplicitScanRoot(cwd, value)));
  return roots.filter((root, index) => roots.findIndex((entry) => path.resolve(entry.path) === path.resolve(root.path)) === index);
}

async function resolveExplicitScanRoot(cwd: string, source: string): Promise<ScanRoot> {
  if (source === "openclaw" || source === "codex" || source === "claude_code") {
    const targetPath = resolveDefaultTargetPath(source as TargetType);
    if (!targetPath || !(await exists(targetPath))) {
      throw new CliError(`Default ${source} skills directory was not found.`, 2);
    }
    return { label: source, path: targetPath, sourceKind: "target" };
  }

  const resolvedPath = path.resolve(cwd, source);
  if (!(await exists(resolvedPath))) {
    throw new CliError(`Adopt path does not exist: ${source}`, 2);
  }
  return {
    label: path.relative(cwd, resolvedPath) || ".",
    path: resolvedPath,
    sourceKind: "local"
  };
}

async function discoverSkillEntries(rootDir: string, scanRoot: ScanRoot): Promise<DiscoveredSkillEntry[]> {
  const discovered = new Map<string, DiscoveredSkillEntry>();
  await walkForSkills(rootDir, scanRoot, scanRoot.path, discovered);
  return [...discovered.values()];
}

async function walkForSkills(
  rootDir: string,
  scanRoot: ScanRoot,
  currentPath: string,
  discovered: Map<string, DiscoveredSkillEntry>
): Promise<void> {
  if (await isSkillRoot(currentPath)) {
    const skill = await createManifestSkill(rootDir, currentPath, scanRoot.sourceKind);
    if (!discovered.has(skill.manifestSkill.id)) {
      discovered.set(skill.manifestSkill.id, skill);
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
    if (entry.name.startsWith(".") && path.resolve(currentPath) === path.resolve(scanRoot.path)) {
      continue;
    }
    await walkForSkills(rootDir, scanRoot, path.join(currentPath, entry.name), discovered);
  }
}

async function isSkillRoot(candidatePath: string): Promise<boolean> {
  return (await exists(path.join(candidatePath, "skill.yaml"))) || (await exists(path.join(candidatePath, "SKILL.md")));
}

async function createManifestSkill(
  rootDir: string,
  skillRoot: string,
  sourceKind: "local" | "target"
): Promise<DiscoveredSkillEntry> {
  void rootDir;
  await assertSkillRootMarker(skillRoot, `Adopted skill ${skillRoot}`);
  const metadata = await loadSkillMetadata(skillRoot);
  const version = metadata?.version ?? "unversioned";
  return {
    manifestSkill: {
      id: metadata?.id ?? `local/${path.basename(skillRoot)}`,
      version
    },
    skillRoot,
    hasVersion: Boolean(metadata?.version),
    source: {
      kind: sourceKind,
      value: skillRoot
    }
  };
}
