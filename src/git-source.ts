import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { ManifestSource } from "./types";
import { ensureDir, isDirectory, sanitizeSkillId } from "./utils";

const execFileAsync = promisify(execFile);
const GIT_SKILLS_ROOT = "skills";
const SCP_LIKE_GIT_URL_PATTERN = /^[^/@\s]+@[^:/\s]+:.+$/;
const GIT_HARDENED_CONFIG_ARGS = [
  "-c", "credential.helper=",
  "-c", "core.askPass=",
  "-c", "credential.interactive=never",
  "-c", "protocol.file.allow=never"
] as const;

export const PHASE1_GIT_SOURCE_POLICY_MESSAGE = "Phase 1 only supports public anonymous HTTPS git sources.";

export interface LoadedGitSource {
  path: string;
  revision: string;
}

export function validatePhase1GitSourceUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return PHASE1_GIT_SOURCE_POLICY_MESSAGE;
  }
  if (SCP_LIKE_GIT_URL_PATTERN.test(trimmed)) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} SCP-like git@host:repo URLs are not allowed.`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} Use an https:// URL without embedded credentials.`;
  }

  if (parsed.protocol !== "https:") {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} ${parsed.protocol}// URLs are not allowed.`;
  }
  if (parsed.username || parsed.password) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} URLs with embedded credentials are not allowed.`;
  }
  if (parsed.search.length > 1) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} Query strings are not allowed in Phase 1.`;
  }
  if (parsed.hash.length > 1) {
    return `${PHASE1_GIT_SOURCE_POLICY_MESSAGE} URL fragments are not allowed in Phase 1.`;
  }
  return null;
}

export async function loadGitSource(
  cacheRoot: string,
  source: ManifestSource
): Promise<LoadedGitSource> {
  const sourceUrlError = validatePhase1GitSourceUrl(source.url);
  if (sourceUrlError) {
    throw new CliError(`Unable to load git source ${source.name} from ${source.url}: ${sourceUrlError}`, 2);
  }

  const repoPath = path.join(cacheRoot, sanitizeSkillId(source.name));
  await rm(repoPath, { recursive: true, force: true });
  await ensureDir(cacheRoot);

  const gitExecutionContext = await createIsolatedGitExecutionContext();
  try {
    try {
      await execFileAsync("git", [...GIT_HARDENED_CONFIG_ARGS, "clone", "--depth", "1", "--no-tags", source.url, repoPath], {
        cwd: gitExecutionContext.cwd,
        env: gitExecutionContext.env
      });
    } catch (error) {
      throw new CliError(
        `Unable to clone git source ${source.name} from ${source.url}: ${formatGitError(error)}`,
        4
      );
    }

    try {
      const { stdout } = await execFileAsync("git", [...GIT_HARDENED_CONFIG_ARGS, "-C", repoPath, "rev-parse", "HEAD"], {
        cwd: gitExecutionContext.cwd,
        env: gitExecutionContext.env
      });
      return {
        path: repoPath,
        revision: stdout.trim()
      };
    } catch (error) {
      throw new CliError(`Unable to read git revision for ${source.name}: ${formatGitError(error)}`, 4);
    }
  } finally {
    await gitExecutionContext.cleanup();
  }
}

export async function findMatchingGitSkillVersion(
  repoPath: string,
  skillId: string,
  range: string | undefined
): Promise<{ version: string; skillRoot: string }> {
  const skillVersionsRoot = path.join(repoPath, GIT_SKILLS_ROOT, ...splitSkillId(skillId));
  if (!(await isDirectory(skillVersionsRoot))) {
    throw new CliError(
      `Skill ${skillId} was not found in git source layout ${GIT_SKILLS_ROOT}/<id>/<version>`,
      3
    );
  }

  const entries = await readdir(skillVersionsRoot, { withFileTypes: true });
  const availableVersions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((version) => semver.valid(version));
  const selectedVersion = range ? semver.maxSatisfying(availableVersions, range) : semver.rsort(availableVersions)[0];
  if (!selectedVersion) {
    const detail = range ? ` matching ${range}` : "";
    throw new CliError(`Skill ${skillId} has no git repo version${detail}`, 3);
  }

  return {
    version: selectedVersion,
    skillRoot: path.join(skillVersionsRoot, selectedVersion)
  };
}

function splitSkillId(skillId: string): string[] {
  return skillId.replaceAll("\\", "/").split("/").filter(Boolean);
}

interface IsolatedGitExecutionContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

async function createIsolatedGitExecutionContext(): Promise<IsolatedGitExecutionContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-git-"));
  const homeDir = path.join(tempRoot, "home");
  const xdgConfigHome = path.join(tempRoot, "xdg");
  const workDir = path.join(tempRoot, "work");
  await Promise.all([ensureDir(homeDir), ensureDir(xdgConfigHome), ensureDir(workDir)]);
  return {
    cwd: workDir,
    env: buildIsolatedGitEnv(homeDir, xdgConfigHome),
    cleanup: async () => rm(tempRoot, { recursive: true, force: true })
  };
}

function buildIsolatedGitEnv(homeDir: string, xdgConfigHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith("GIT_") || key === "HOME" || key === "XDG_CONFIG_HOME" || key === "SSH_ASKPASS") {
      continue;
    }
    env[key] = value;
  }

  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = xdgConfigHome;
  env.GIT_CONFIG_GLOBAL = path.join(homeDir, ".gitconfig");
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";
  env.SSH_ASKPASS = "";
  return env;
}

function formatGitError(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) {
    return error.stderr.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
