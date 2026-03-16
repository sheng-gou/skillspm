import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { ScopeLayout } from "./scope";
import type { LibrarySkillSource } from "./types";
import {
  assertNoSymlinksInTree,
  assertPathWithinRootReal,
  assertSkillRootMarker,
  buildInstalledEntryName,
  copyDir,
  ensureDir,
  exists,
  isDirectory
} from "./utils";

const execFileAsync = promisify(execFile);
const TEST_GITHUB_ROOT_ENV = "SKILLSPM_TEST_GITHUB_ROOT";
const PROVIDER_RECOVERY_GIT_CONFIG = ["-c", "credential.helper=", "-c", "core.askPass=", "-c", "credential.interactive=never"];

export interface ProviderMaterializationResult {
  installPath?: string;
  failureReason?: string;
}

interface ParsedGitHubSkillId {
  owner: string;
  repo: string;
  skillPath?: string;
}

export async function materializeProviderSource(
  layout: ScopeLayout,
  skillId: string,
  version: string,
  source: LibrarySkillSource
): Promise<ProviderMaterializationResult> {
  const githubSource = parseGitHubProviderSource(source);
  if (!githubSource.ok) {
    return {
      failureReason: githubSource.failureReason
    };
  }

  const cachePath = path.join(layout.librarySkillsDir, buildInstalledEntryName(skillId, version));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillspm-provider-"));
  const checkoutDir = path.join(tempRoot, "repo");

  try {
    await ensureDir(layout.librarySkillsDir);
    const repoUrl = await resolveGitHubRepoUrl(githubSource.parsed.owner, githubSource.parsed.repo);
    await runGit(["clone", "--depth", "1", "--no-checkout", repoUrl, checkoutDir]);
    await runGit(["-C", checkoutDir, "fetch", "--depth", "1", "origin", githubSource.ref]);
    await runGit(["-C", checkoutDir, "checkout", "--detach", "FETCH_HEAD"]);

    const materializedRoot = githubSource.parsed.skillPath
      ? path.resolve(checkoutDir, githubSource.parsed.skillPath)
      : checkoutDir;
    await assertPathWithinRootReal(checkoutDir, materializedRoot, `Recorded provider source path for ${skillId}@${version}`);

    if (!(await exists(materializedRoot)) || !(await isDirectory(materializedRoot))) {
      return {
        failureReason: `recorded provider source path is missing in fetched github ref ${githubSource.ref}: ${source.value}`
      };
    }

    try {
      await assertSkillRootMarker(materializedRoot, `Recorded provider source for ${skillId}@${version}`);
      await assertNoSymlinksInTree(materializedRoot, `Recorded provider source for ${skillId}@${version}`);
    } catch (error) {
      return {
        failureReason: error instanceof Error ? error.message : `recorded provider source is not a valid skill root: ${source.value}`
      };
    }

    await copyDir(materializedRoot, cachePath, { dereference: true });
    return {
      installPath: cachePath
    };
  } catch (error) {
    await rm(cachePath, { recursive: true, force: true });
    return {
      failureReason: buildGitHubFetchFailureReason(source.value, githubSource.ref, error)
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseGitHubProviderSource(source: LibrarySkillSource):
  | { ok: true; parsed: ParsedGitHubSkillId; ref: string }
  | { ok: false; failureReason: string } {
  if (source.kind !== "provider") {
    return {
      ok: false,
      failureReason: `recorded source.kind must be provider for provider re-materialization, received ${source.kind}`
    };
  }

  if (!source.provider) {
    return {
      ok: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: expected source.provider.name, source.provider.ref, and source.provider.visibility=public in library.yaml"
    };
  }

  if (source.provider.name !== "github") {
    return {
      ok: false,
      failureReason: `recorded provider source is insufficient for re-materialization: only public github provider provenance is supported, received ${source.provider.name}`
    };
  }

  if (!source.provider.ref) {
    return {
      ok: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: github recovery requires source.provider.ref in library.yaml"
    };
  }

  if (source.provider.visibility !== "public") {
    return {
      ok: false,
      failureReason:
        "recorded provider source is insufficient for re-materialization: github recovery only supports source.provider.visibility=public"
    };
  }

  const parsed = parseGitHubSkillId(source.value);
  if (!parsed) {
    return {
      ok: false,
      failureReason:
        `recorded provider source is insufficient for re-materialization: expected source.value to be a canonical github:owner/repo[/path] id, received ${source.value}`
    };
  }

  return {
    ok: true,
    parsed,
    ref: source.provider.ref
  };
}

function parseGitHubSkillId(value: string): ParsedGitHubSkillId | undefined {
  if (!value.startsWith("github:")) {
    return undefined;
  }

  const segments = value.slice("github:".length).split("/").filter(Boolean);
  if (segments.length < 2) {
    return undefined;
  }

  const owner = segments[0];
  const repo = segments[1];
  const skillPath = segments.slice(2).join("/");
  return {
    owner,
    repo,
    ...(skillPath ? { skillPath } : {})
  };
}

async function resolveGitHubRepoUrl(owner: string, repo: string): Promise<string> {
  const testRoot = process.env[TEST_GITHUB_ROOT_ENV];
  if (testRoot) {
    if (/^https?:\/\//i.test(testRoot)) {
      return `${testRoot.replace(/\/+$/, "")}/${owner}/${repo}.git`;
    }

    const bareCandidate = path.join(testRoot, owner, `${repo}.git`);
    if (await exists(bareCandidate)) {
      return bareCandidate;
    }

    const candidate = path.join(testRoot, owner, repo);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return `https://github.com/${owner}/${repo}.git`;
}

async function runGit(args: string[]): Promise<void> {
  const env = {
    ...process.env,
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  } as NodeJS.ProcessEnv;

  for (const key of Object.keys(env)) {
    if (key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_COUNT") || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) {
      delete env[key];
    }
  }

  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;

  await execFileAsync("git", [...PROVIDER_RECOVERY_GIT_CONFIG, ...args], {
    env,
    maxBuffer: 10 * 1024 * 1024
  });
}

function buildGitHubFetchFailureReason(sourceValue: string, ref: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `public github fetch failed for ${sourceValue} at ${ref}: ${detail}. Direct provider recovery only supports unauthenticated access to public GitHub repos in this build`;
}
