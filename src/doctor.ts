import path from "node:path";
import { readdir } from "node:fs/promises";
import { resolveDefaultTargetPath } from "./adapter";
import { loadLibrary, resolveCachedSkillPath } from "./library";
import { loadLockfile } from "./lockfile";
import { verifyLockedSkillPathIdentity } from "./lockfile";
import { loadManifest, loadManifestFromPath } from "./manifest";
import { resolveScopeLayout, type ScopeLayout } from "./scope";
import { loadSkillMetadata, resolveSkillMarkdownPath } from "./skill";
import type { ManifestTarget } from "./types";
import { detectPlatformOs, exists, printInfo, printWarning, resolveCleanupRoot, resolveFileUrlOrPath } from "./utils";

export interface DoctorFinding {
  level: "info" | "warning" | "error";
  message: string;
  skillId?: string;
  path?: string;
}

export interface DoctorReport {
  scope: ScopeLayout["scope"];
  rootDir: string;
  currentDirectory: string;
  libraryFile: string;
  currentDirectoryPackCount: number;
  otherScopeManifestPresent: boolean;
  rootSkillCount: number;
  lockedSkillCount: number;
  warningCount: number;
  errorCount: number;
  result: "healthy" | "warnings" | "failed";
  findings: DoctorFinding[];
}

export interface DoctorOptions {
  json?: boolean;
}

export async function runDoctor(layout: ScopeLayout, options: DoctorOptions = {}): Promise<number> {
  const report = await collectDoctorReport(layout);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.errorCount > 0 ? 6 : 0;
  }

  printInfo("Skills Doctor Report");
  for (const finding of report.findings) {
    if (finding.level === "warning") {
      printWarning(finding.message);
      continue;
    }
    printInfo(`${finding.level.toUpperCase().padEnd(5)} ${finding.message}`);
  }
  if (report.result === "failed") {
    printInfo("Result: failed");
    return 6;
  }
  if (report.result === "warnings") {
    printInfo("Result: warnings found");
    return 0;
  }
  printInfo("Result: healthy");
  return 0;
}

async function collectDoctorReport(layout: ScopeLayout): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];
  let warningCount = 0;
  let errorCount = 0;
  let lockedSkillCount = 0;
  let packReady = false;

  const currentOs = detectPlatformOs();
  const manifest = await loadManifest(layout.rootDir);
  findings.push({
    level: "info",
    message: `${layout.scope} manifest loaded (${manifest.skills.length} root skill${manifest.skills.length === 1 ? "" : "s"})`
  });
  findings.push({
    level: "info",
    message: "manifest contract validated (public skills.yaml shape is skills[+source] + targets)"
  });
  findings.push({
    level: "info",
    message: `host platform detected: ${currentOs}`
  });
  findings.push({
    level: "info",
    message: `machine-local library: ${layout.libraryFile}`
  });
  const packResult = await collectPackFindings(process.cwd());
  warningCount += packResult.warningCount;
  findings.push(...packResult.findings);
  const scopeResult = await collectScopeConflictFindings(layout, manifest);
  warningCount += scopeResult.warningCount;
  findings.push(...scopeResult.findings);

  const enabledTargets = (manifest.targets ?? [{ type: "openclaw" as const }]).filter((target) => target.enabled !== false);
  findings.push({
    level: "info",
    message: `${enabledTargets.length} sync target${enabledTargets.length === 1 ? "" : "s"} enabled`
  });
  for (const target of enabledTargets) {
    const result = await collectTargetCompatibilityFindings(layout, target);
    warningCount += result.warningCount;
    errorCount += result.errorCount;
    findings.push(...result.findings);
  }

  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: `no skills.lock found; run \`skillspm install${layout.scope === "global" ? " -g" : ""}\` or \`skillspm freeze${layout.scope === "global" ? " -g" : ""}\``
    });
    findings.push({
      level: "warning",
      message: "pack readiness blocked until skills.lock exists"
    });
  } else {
    const library = await loadLibrary(layout);
    lockedSkillCount = Object.keys(lockfile.skills).length;
    packReady = lockedSkillCount > 0;
    findings.push({
      level: "info",
      message: `${lockedSkillCount} skills locked`
    });

    for (const [skillId, entry] of Object.entries(lockfile.skills)) {
      const version = entry.version;
      const cachedPath = await resolveCachedSkillPath(layout, library, skillId, version);
      if (!cachedPath) {
        packReady = false;
        errorCount += 1;
        findings.push({
          level: "error",
          message: `cached directory missing for ${skillId}@${version}`,
          skillId,
          path: path.join(layout.librarySkillsDir, `${skillId}@${version}`)
        });
        continue;
      }

      try {
        await verifyLockedSkillPathIdentity(skillId, entry, cachedPath, "Cached materialized content");
      } catch (error) {
        packReady = false;
        errorCount += 1;
        findings.push({
          level: "error",
          message: error instanceof Error ? error.message : String(error),
          skillId,
          path: cachedPath
        });
        continue;
      }

      const metadata = await loadSkillMetadata(cachedPath);
      if (!metadata) {
        warningCount += 1;
        findings.push({
          level: "warning",
          message: `missing skill.yaml in ${cachedPath}`,
          skillId,
          path: cachedPath
        });
      }

      const skillMarkdownPath = await resolveSkillMarkdownPath(cachedPath, metadata);
      if (!skillMarkdownPath) {
        packReady = false;
        errorCount += 1;
        findings.push({
          level: "error",
          message: `missing SKILL.md in ${cachedPath}`,
          skillId,
          path: cachedPath
        });
      }

      if (version === "unversioned") {
        warningCount += 1;
        findings.push({
          level: "warning",
          message: `${skillId} has no version metadata`,
          skillId,
          path: cachedPath
        });
      }

      const requiredBinaries = metadata?.requires?.binaries ?? [];
      for (const binary of requiredBinaries) {
        if (!(await commandExists(binary))) {
          warningCount += 1;
          findings.push({
            level: "warning",
            message: `missing binary ${binary} required by ${skillId}`,
            skillId,
            path: cachedPath
          });
        }
      }

      const requiredEnv = metadata?.requires?.env ?? [];
      for (const envVar of requiredEnv) {
        if (!process.env[envVar]) {
          warningCount += 1;
          findings.push({
            level: "warning",
            message: `missing env var ${envVar} for ${skillId}`,
            skillId,
            path: cachedPath
          });
        }
      }

      const osSupport = metadata?.compatibility?.os;
      if (Array.isArray(osSupport) && osSupport.length > 0 && !osSupport.includes(currentOs)) {
        warningCount += 1;
        findings.push({
          level: "warning",
          message: `${skillId} does not list ${currentOs} in compatibility.os`,
          skillId,
          path: cachedPath
        });
      }
    }

    findings.push({
      level: packReady ? "info" : "warning",
      message: packReady
        ? `pack readiness confirmed for ${lockedSkillCount} locked skill${lockedSkillCount === 1 ? "" : "s"}`
        : lockedSkillCount === 0
          ? "pack readiness blocked until at least one skill is locked"
          : "pack readiness blocked by missing cached files or missing SKILL.md"
    });
    if (!packReady) {
      warningCount += 1;
    }
  }

  return {
    scope: layout.scope,
    rootDir: layout.rootDir,
    currentDirectory: process.cwd(),
    libraryFile: layout.libraryFile,
    currentDirectoryPackCount: packResult.packCount,
    otherScopeManifestPresent: scopeResult.otherScopeManifestPresent,
    rootSkillCount: manifest.skills.length,
    lockedSkillCount,
    warningCount,
    errorCount,
    result: errorCount > 0 ? "failed" : warningCount > 0 ? "warnings" : "healthy",
    findings
  };
}

async function collectPackFindings(
  cwd: string
): Promise<{ findings: DoctorFinding[]; warningCount: number; packCount: number }> {
  const entries = await readdir(cwd, { withFileTypes: true });
  const packs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".skillspm.tgz"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const findings: DoctorFinding[] = [{
    level: "info",
    message: `${packs.length} current-directory pack${packs.length === 1 ? "" : "s"} found`
  }];

  if (packs.length > 1) {
    findings.push({
      level: "warning",
      message: "multiple current-directory packs would make `skillspm install` require an explicit pack path"
    });
    return { findings, warningCount: 1, packCount: packs.length };
  }

  return { findings, warningCount: 0, packCount: packs.length };
}

async function collectScopeConflictFindings(
  layout: ScopeLayout,
  manifest: Awaited<ReturnType<typeof loadManifest>>
): Promise<{ findings: DoctorFinding[]; warningCount: number; otherScopeManifestPresent: boolean }> {
  const otherLayout = resolveScopeLayout(process.cwd(), layout.scope === "project");
  if (path.resolve(otherLayout.rootDir) === path.resolve(layout.rootDir)) {
    return { findings: [], warningCount: 0, otherScopeManifestPresent: false };
  }

  const otherManifestPath = path.join(otherLayout.rootDir, "skills.yaml");
  if (!(await exists(otherManifestPath))) {
    return { findings: [], warningCount: 0, otherScopeManifestPresent: false };
  }

  const otherManifest = await loadManifestFromPath(otherManifestPath);
  const sharedSkillConflicts = manifest.skills.filter((skill) => {
    const other = otherManifest.skills.find((candidate) => candidate.id === skill.id);
    return other && other.version !== skill.version;
  }).length;
  const sharedTargetConflicts = (manifest.targets ?? []).filter((target) => {
    const other = otherManifest.targets?.find((candidate) => candidate.type === target.type);
    return other && (other.path !== target.path || other.enabled !== target.enabled);
  }).length;

  if (sharedSkillConflicts === 0 && sharedTargetConflicts === 0) {
    return {
      findings: [{
        level: "info",
        message: `${otherLayout.scope} manifest also exists at ${otherManifestPath}; no overlapping scope conflicts detected`
      }],
      warningCount: 0,
      otherScopeManifestPresent: true
    };
  }

  return {
    findings: [{
      level: "warning",
      message: `${layout.scope} and ${otherLayout.scope} manifests differ on ${sharedSkillConflicts} shared skill${sharedSkillConflicts === 1 ? "" : "s"} and ${sharedTargetConflicts} shared target${sharedTargetConflicts === 1 ? "" : "s"}`
    }],
    warningCount: 1,
    otherScopeManifestPresent: true
  };
}

async function collectTargetCompatibilityFindings(
  layout: ScopeLayout,
  target: ManifestTarget
): Promise<{ findings: DoctorFinding[]; warningCount: number; errorCount: number }> {
  const findings: DoctorFinding[] = [];
  let warningCount = 0;
  let errorCount = 0;

  const resolvedPath = target.path ? resolveFileUrlOrPath(layout.rootDir, target.path) : resolveDefaultTargetPath(target.type);
  if (!resolvedPath) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: `target ${target.type} requires an explicit path before sync can run`
    });
    return { findings, warningCount, errorCount };
  }

  const containmentRoot = target.path ? layout.rootDir : path.dirname(resolvedPath);
  try {
    await resolveCleanupRoot(resolvedPath, {
      containmentRoot,
      label: `target ${target.type} path ${resolvedPath}`
    });
  } catch (error) {
    errorCount += 1;
    findings.push({
      level: "error",
      message: error instanceof Error ? error.message : String(error),
      path: resolvedPath
    });
    return { findings, warningCount, errorCount };
  }

  if (target.type === "codex" && !(await commandExists("codex"))) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: "codex target is enabled but the codex binary was not found in PATH on this host",
      path: resolvedPath
    });
  }

  if (target.type === "claude_code" && !(await commandExists("claude"))) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: "claude_code target is enabled but the claude binary was not found in PATH on this host",
      path: resolvedPath
    });
  }

  if (!(await exists(resolvedPath))) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: `target path does not exist yet: ${resolvedPath}`,
      path: resolvedPath
    });
  }

  return { findings, warningCount, errorCount };
}

async function commandExists(binary: string): Promise<boolean> {
  const { spawn } = await import("node:child_process");
  return await new Promise<boolean>((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${binary}`], { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}
