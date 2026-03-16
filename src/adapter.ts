import os from "node:os";
import path from "node:path";
import { rm, symlink } from "node:fs/promises";
import { loadLibrary, resolveCachedSkillPath } from "./library";
import { loadLockfile } from "./lockfile";
import { CliError } from "./errors";
import type { ScopeLayout } from "./scope";
import type { InstallMode, ManifestTarget, SkillsManifest, TargetType } from "./types";
import { assertConfiguredPathWithinRootReal, assertPathWithinRootReal, copyDir, ensureDir } from "./utils";

export interface SyncOptions {
  mode?: string;
  targetType?: string;
}

interface ResolvedTarget {
  type: TargetType;
  path: string;
  containmentRoot?: string;
  configuredPath?: string;
}

interface SyncSkillEntry {
  skillId: string;
  version: string;
  sourcePath: string;
  entryName: string;
}

export function resolveInstallMode(mode?: string): InstallMode {
  const selected = mode ?? "copy";
  if (selected !== "copy" && selected !== "symlink") {
    throw new CliError(`Unsupported sync mode ${selected}. Use copy or symlink.`, 2);
  }
  return selected;
}

export function resolveDefaultTargetPath(type: TargetType): string | undefined {
  const homeDir = os.homedir();
  switch (type) {
    case "openclaw":
      return path.join(homeDir, ".openclaw", "skills");
    case "codex":
      return path.join(homeDir, ".codex", "skills");
    case "claude_code":
      return path.join(homeDir, ".claude", "skills");
    case "generic":
      return undefined;
  }
}

export async function syncTargets(layout: ScopeLayout, manifest: SkillsManifest, options: SyncOptions = {}): Promise<void> {
  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    throw new CliError("No skills.lock found. Run `skillspm install` or `skillspm freeze` first.", 2);
  }

  const entries = Object.entries(lockfile.skills).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new CliError("No locked skills found. Run `skillspm install` or `skillspm freeze` first.", 2);
  }

  const targets = resolveTargets(layout.rootDir, manifest, options.targetType);
  if (targets.length === 0) {
    throw new CliError("No enabled sync targets found in skills.yaml.", 2);
  }

  const library = await loadLibrary(layout);
  const mode = resolveInstallMode(options.mode);
  const syncEntries: SyncSkillEntry[] = [];

  for (const [skillId, version] of entries) {
    const sourcePath = await resolveCachedSkillPath(layout, library, skillId, version);
    if (!sourcePath) {
      throw new CliError(`Cached files for ${skillId}@${version} are missing from ${layout.librarySkillsDir}.`, 4);
    }

    syncEntries.push({
      skillId,
      version,
      sourcePath,
      entryName: path.basename(sourcePath)
    });
  }

  await validateTargetsBeforeSync(targets, syncEntries);

  for (const target of targets) {
    await ensureDir(target.path);

    for (const entry of syncEntries) {
      const targetPath = path.join(target.path, entry.entryName);
      if (mode === "symlink") {
        await rm(targetPath, { recursive: true, force: true });
        await symlink(entry.sourcePath, targetPath, "dir");
      } else {
        await copyDir(entry.sourcePath, targetPath);
      }
    }
  }
}

function resolveTargets(cwd: string, manifest: SkillsManifest, requestedTarget?: string): ResolvedTarget[] {
  if (requestedTarget) {
    return parseTargetSelector(requestedTarget).map((targetType) => (
      resolveTarget(cwd, manifest.targets?.find((target) => target.type === targetType) ?? { type: targetType })
    ));
  }

  const configuredTargets = manifest.targets ?? [];
  if (configuredTargets.length === 0) {
    return [resolveTarget(cwd, { type: "openclaw" })];
  }

  return configuredTargets
    .filter((target) => target.enabled !== false)
    .map((target) => resolveTarget(cwd, target));
}

function resolveTarget(cwd: string, target: ManifestTarget): ResolvedTarget {
  const resolvedPath = target.path ? path.resolve(cwd, target.path) : resolveDefaultTargetPath(target.type);
  if (!resolvedPath) {
    throw new CliError(`Target ${target.type} requires an explicit path in skills.yaml.`, 2);
  }
  return {
    type: target.type,
    path: resolvedPath,
    containmentRoot: target.path ? cwd : path.dirname(resolvedPath),
    configuredPath: target.path
  };
}

function parseTargetSelector(value: string): TargetType[] {
  const targets = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => parseTargetType(entry)))];
  if (targets.length === 0) {
    throw new CliError("Target selector must not be empty.", 2);
  }
  return targets;
}

function parseTargetType(value: string): TargetType {
  if (value === "openclaw" || value === "codex" || value === "claude_code" || value === "generic") {
    return value;
  }
  throw new CliError(`Unknown target ${value}. Use openclaw, codex, claude_code, or generic.`, 2);
}

async function validateTargetsBeforeSync(targets: ResolvedTarget[], syncEntries: SyncSkillEntry[]): Promise<void> {
  for (const target of targets) {
    await validateTargetContainment(target);
    for (const entry of syncEntries) {
      await assertPathWithinRootReal(
        target.path,
        path.join(target.path, entry.entryName),
        `sync destination for ${entry.skillId}@${entry.version}`
      );
    }
  }
}

async function validateTargetContainment(target: ResolvedTarget): Promise<void> {
  if (!target.containmentRoot) {
    return;
  }

  if (target.configuredPath) {
    await assertConfiguredPathWithinRootReal(
      target.containmentRoot,
      target.configuredPath,
      target.path,
      `target ${target.type} path ${target.configuredPath}`
    );
    return;
  }

  await assertPathWithinRootReal(target.containmentRoot, target.path, `target ${target.type} path ${target.path}`);
}
