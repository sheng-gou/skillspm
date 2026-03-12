import path from "node:path";
import { loadLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import type { ScopeLayout } from "./scope";
import { loadSkillMetadata, resolveSkillMarkdownPath } from "./skill";
import { buildInstalledEntryName, detectPlatformOs, exists, printInfo, printWarning } from "./utils";

export interface DoctorFinding {
  level: "info" | "warning" | "error";
  message: string;
  skillId?: string;
  path?: string;
}

export interface DoctorReport {
  scope: ScopeLayout["scope"];
  rootDir: string;
  installedRoot: string;
  rootSkillCount: number;
  resolvedSkillCount: number;
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
  let resolvedSkillCount = 0;

  const manifest = await loadManifest(layout.rootDir);
  findings.push({
    level: "info",
    message: `${layout.scope} manifest loaded (${manifest.skills.length} root skill${manifest.skills.length === 1 ? "" : "s"})`
  });

  const lockfile = await loadLockfile(layout.rootDir);
  if (!lockfile) {
    warningCount += 1;
    findings.push({
      level: "warning",
      message: `no skills.lock found; run \`skills install${layout.scope === "global" ? " -g" : ""}\` to resolve dependencies`
    });
  } else {
    resolvedSkillCount = Object.keys(lockfile.resolved).length;
    findings.push({
      level: "info",
      message: `${resolvedSkillCount} skills resolved`
    });

    for (const [skillId, node] of Object.entries(lockfile.resolved)) {
      const installDir = path.join(layout.installedRoot, buildInstalledEntryName(skillId, node.version));
      if (!(await exists(installDir))) {
        errorCount += 1;
        findings.push({
          level: "error",
          message: `installed directory missing for ${skillId}: ${installDir}`,
          skillId,
          path: installDir
        });
        continue;
      }

      const metadata = await loadSkillMetadata(installDir);
      if (!metadata) {
        warningCount += 1;
        findings.push({
          level: "warning",
          message: `missing skill.yaml in ${installDir}`,
          skillId,
          path: installDir
        });
      }

      const skillMarkdownPath = await resolveSkillMarkdownPath(installDir, metadata);
      if (!skillMarkdownPath) {
        errorCount += 1;
        findings.push({
          level: "error",
          message: `missing SKILL.md in ${installDir}`,
          skillId,
          path: installDir
        });
      }

      if (node.version === "unversioned") {
        warningCount += 1;
        findings.push({
          level: "warning",
          message: `${skillId} has no version metadata`,
          skillId,
          path: installDir
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
            path: installDir
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
            path: installDir
          });
        }
      }

      const osSupport = metadata?.compatibility?.os;
      if (Array.isArray(osSupport) && osSupport.length > 0) {
        const currentOs = detectPlatformOs();
        if (!osSupport.includes(currentOs)) {
          warningCount += 1;
          findings.push({
            level: "warning",
            message: `${skillId} does not list ${currentOs} in compatibility.os`,
            skillId,
            path: installDir
          });
        }
      }
    }
  }

  return {
    scope: layout.scope,
    rootDir: layout.rootDir,
    installedRoot: layout.installedRoot,
    rootSkillCount: manifest.skills.length,
    resolvedSkillCount,
    warningCount,
    errorCount,
    result: errorCount > 0 ? "failed" : warningCount > 0 ? "warnings" : "healthy",
    findings
  };
}

async function commandExists(binary: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, binary);
    if (await exists(candidate)) {
      return true;
    }
  }
  return false;
}
