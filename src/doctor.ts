import path from "node:path";
import { loadLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import { loadSkillMetadata, resolveSkillMarkdownPath } from "./skill";
import { detectPlatformOs, exists, printInfo, printWarning, sanitizeInstalledSkillVersion, sanitizeSkillId } from "./utils";

export async function runDoctor(cwd: string): Promise<number> {
  printInfo("Skills Doctor Report");
  const manifest = await loadManifest(cwd);
  printInfo(`INFO  project manifest loaded (${manifest.skills.length} root skill${manifest.skills.length === 1 ? "" : "s"})`);

  let hasErrors = false;
  let warnings = 0;
  const lockfile = await loadLockfile(cwd);
  if (!lockfile) {
    printWarning("no skills.lock found; run `skills install` to resolve dependencies");
    warnings += 1;
  } else {
    printInfo(`INFO  ${Object.keys(lockfile.resolved).length} skills resolved`);
    const installedRoot = path.join(cwd, ".skills", "installed");
    for (const [skillId, node] of Object.entries(lockfile.resolved)) {
      const installDir = path.join(installedRoot, `${sanitizeSkillId(skillId)}@${sanitizeInstalledSkillVersion(node.version)}`);
      if (!(await exists(installDir))) {
        process.stdout.write(`ERROR installed directory missing for ${skillId}: ${installDir}\n`);
        hasErrors = true;
        continue;
      }

      const metadata = await loadSkillMetadata(installDir);
      if (!metadata) {
        printWarning(`missing skill.yaml in ${installDir}`);
        warnings += 1;
      }

      const skillMarkdownPath = await resolveSkillMarkdownPath(installDir, metadata);
      if (!skillMarkdownPath) {
        process.stdout.write(`ERROR missing SKILL.md in ${installDir}\n`);
        hasErrors = true;
      }

      if (node.version === "unversioned") {
        printWarning(`${skillId} has no version metadata`);
        warnings += 1;
      }

      const requiredBinaries = metadata?.requires?.binaries ?? [];
      for (const binary of requiredBinaries) {
        if (!(await commandExists(binary))) {
          printWarning(`missing binary ${binary} required by ${skillId}`);
          warnings += 1;
        }
      }

      const requiredEnv = metadata?.requires?.env ?? [];
      for (const envVar of requiredEnv) {
        if (!process.env[envVar]) {
          printWarning(`missing env var ${envVar} for ${skillId}`);
          warnings += 1;
        }
      }

      const osSupport = metadata?.compatibility?.os;
      if (Array.isArray(osSupport) && osSupport.length > 0) {
        const currentOs = detectPlatformOs();
        if (!osSupport.includes(currentOs)) {
          printWarning(`${skillId} does not list ${currentOs} in compatibility.os`);
          warnings += 1;
        }
      }
    }
  }

  if (hasErrors) {
    printInfo("Result: failed");
    return 6;
  }
  if (warnings > 0) {
    printInfo("Result: warnings found");
    return 0;
  }
  printInfo("Result: healthy");
  return 0;
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
