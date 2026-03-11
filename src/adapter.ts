import os from "node:os";
import path from "node:path";
import { readdir, rm, symlink } from "node:fs/promises";
import { CliError } from "./errors";
import type { InstallMode, ManifestTarget, SkillsManifest, TargetType } from "./types";
import { copyDir, ensureDir, exists, printInfo, printSuccess } from "./utils";

export interface SyncOptions {
  mode?: string;
  targetType?: string;
}

interface ResolvedTarget {
  type: TargetType;
  path: string;
}

export function resolveInstallMode(mode?: string, fallback?: InstallMode): InstallMode {
  const selected = mode ?? fallback ?? "copy";
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

export async function syncTargets(cwd: string, manifest: SkillsManifest, options: SyncOptions = {}): Promise<void> {
  const installedRoot = path.join(cwd, ".skills", "installed");
  if (!(await exists(installedRoot))) {
    throw new CliError("No installed skills found. Run `skills install` first.", 2);
  }

  const installedEntries = (await readdir(installedRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (installedEntries.length === 0) {
    throw new CliError("No installed skills found. Run `skills install` first.", 2);
  }

  const targets = resolveTargets(cwd, manifest, options.targetType);
  if (targets.length === 0) {
    throw new CliError("No enabled sync targets found in skills.yaml.", 2);
  }

  const mode = resolveInstallMode(options.mode, manifest.settings?.install_mode);
  printInfo("Syncing targets...");

  for (const target of targets) {
    await ensureDir(target.path);
    for (const entryName of installedEntries) {
      const sourcePath = path.join(installedRoot, entryName);
      const targetPath = path.join(target.path, entryName);
      if (mode === "symlink") {
        await rm(targetPath, { recursive: true, force: true });
        await symlink(sourcePath, targetPath, "dir");
      } else {
        await copyDir(sourcePath, targetPath);
      }
    }
    printSuccess(`${target.type} synced (${mode})`);
  }
}

function resolveTargets(cwd: string, manifest: SkillsManifest, requestedTarget?: string): ResolvedTarget[] {
  if (requestedTarget) {
    const targetType = parseTargetType(requestedTarget);
    return [resolveTarget(cwd, manifest.targets?.find((target) => target.type === targetType) ?? { type: targetType })];
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
    path: resolvedPath
  };
}

function parseTargetType(value: string): TargetType {
  if (value === "openclaw" || value === "codex" || value === "claude_code" || value === "generic") {
    return value;
  }
  throw new CliError(`Unknown target ${value}. Use openclaw, codex, claude_code, or generic.`, 2);
}
