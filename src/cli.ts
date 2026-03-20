import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncTargets } from "./adapter";
import { runDoctor } from "./doctor";
import { CliError } from "./errors";
import { importSkills } from "./importer";
import { runInspect } from "./inspect";
import { installProject } from "./installer";
import { cacheSkill, loadLibrary } from "./library";
import { buildLockfileFromNodes, loadLockfile, writeLockfile } from "./lockfile";
import { createDefaultManifest, isSupportedVersionRange, loadManifest, loadManifestFromPath, saveManifest } from "./manifest";
import { extractPack } from "./pack";
import { packProject } from "./packer";
import { bootstrapPublicProviderSkill, canonicalizePublicGitHubLocator } from "./provider";
import { resolveProject } from "./resolver";
import { formatScopeLabel, resolveScopeLayout } from "./scope";
import { getConfirmedStateRequirementError, getInstallStateNotice, inspectProjectState, isConfirmedProjectState } from "./state";
import { loadSkillMetadata } from "./skill";
import type { ManifestSkill, SkillsManifest } from "./types";
import {
  MANIFEST_FILE,
  ensureDir,
  exists,
  isDirectory,
  printError,
  printInfo,
  printSuccess,
  resolveFileUrlOrPath
} from "./utils";

interface InstallSelection {
  kind: "manifest" | "pack";
  path: string;
}

interface AddSkillOptions {
  commandCwd: string;
  layout: ReturnType<typeof resolveScopeLayout>;
  manifest: SkillsManifest;
  input: string;
  provider?: string;
  bootstrapRemote?: boolean;
}

const PUBLIC_COMMANDS = ["add", "inspect", "install", "pack", "freeze", "adopt", "sync", "doctor", "help"] as const;
const REMOVED_PUBLIC_COMMANDS = new Set(["import"]);

export async function runCli(argv: string[]): Promise<number> {
  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      printInfo(renderHelp());
      return 0;
    }
    if (argv[0] === "help") {
      printInfo(renderHelp(resolvePublicCommand(argv[1])));
      return 0;
    }
    if (argv.length >= 2 && (argv[1] === "--help" || argv[1] === "-h")) {
      printInfo(renderHelp(resolvePublicCommand(argv[0])));
      return 0;
    }
    if (REMOVED_PUBLIC_COMMANDS.has(argv[0])) {
      throw new CliError(`Unknown command ${argv[0]}. Run \`skillspm help\` for public commands.`, 2);
    }

    const program = new Command();
    program.name("skillspm").description("Manage declarative, reproducible Skills environments");

    withScopeOption(
      program
        .command("add")
        .description("Unified add <content> entrypoint for local paths, GitHub URLs, and provider-backed skill ids")
        .argument("<content>", "Local path, GitHub URL, provider-prefixed id, or skill id[@range]")
        .option("--provider <provider>", "Choose the provider for non-path add input such as skill ids or provider shorthand")
        .option("--install", "Run install after writing skills.yaml")
    ).action(async (content: string, options: { install?: boolean; provider?: string; global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const manifest = await loadManifestOrDefault(layout.rootDir);
      const nextManifest = await addSkillToManifest({
        commandCwd: process.cwd(),
        layout,
        manifest,
        input: content,
        provider: options.provider,
        bootstrapRemote: options.install === true
      });
      await saveManifest(layout.rootDir, nextManifest);
      const added = nextManifest.skills[nextManifest.skills.length - 1];
      printSuccess(`Added ${describeManifestSkill(added)} to ${formatScopeLabel(layout.scope)} skills.yaml`);
      if (options.install) {
        await runInstallCommand(layout);
      }
    });

    withScopeOption(
      program
        .command("inspect")
        .description("Explain the current intent, confirmed state, drift, and next safe actions")
        .option("--json", "Emit a machine-readable state snapshot")
    ).action(async (options: { json?: boolean; global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      await runInspect(layout, { json: options.json });
    });

    withScopeOption(
      program
        .command("install")
        .description("Consume confirmed state by default, while still materializing current intent locally when unconfirmed")
        .argument("[input]", "Explicit path to skills.yaml or *.skillspm.tgz")
    ).action(async (inputOrOptions: string | { global?: boolean } | undefined, options?: { global?: boolean }) => {
      const input = typeof inputOrOptions === "string" ? inputOrOptions : undefined;
      const normalizedOptions = typeof inputOrOptions === "string" ? options ?? {} : inputOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      await runInstallCommand(layout, input);
    });

    withScopeOption(
      program
        .command("pack")
        .description("Bundle the confirmed environment into a portable restore supplement for offline or cross-machine recovery")
        .argument("[out]", "Output .skillspm.tgz file")
    ).action(async (outOrOptions: string | { global?: boolean } | undefined, options?: { global?: boolean }) => {
      const out = typeof outOrOptions === "string" ? outOrOptions : undefined;
      const normalizedOptions = typeof outOrOptions === "string" ? options ?? {} : outOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      const state = await inspectProjectState(layout);
      const gateError = getConfirmedStateRequirementError(state, "pack");
      if (gateError) {
        throw new CliError(gateError, 2);
      }
      const outFile = await normalizePackOutputPath(process.cwd(), out ?? `${path.basename(layout.rootDir)}.skillspm.tgz`);
      await packProject(layout, outFile);
    });

    withScopeOption(
      program
        .command("freeze")
        .description("Explicitly refresh skills.lock to the accepted current result")
    ).action(async (options: { global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const resolution = await resolveProject(layout.rootDir);
      const lockfile = buildLockfileFromNodes(resolution.nodes.values());
      await writeLockfile(layout.rootDir, lockfile);
      printSuccess(`Updated skills.lock (${Object.keys(lockfile.skills).length} skill${Object.keys(lockfile.skills).length === 1 ? "" : "s"})`);
    });

    withScopeOption(
      program
        .command("adopt")
        .description("Discover existing skills and merge them into skills.yaml")
        .argument("[source]", "openclaw, codex, claude_code, local path, or comma-separated list")
    ).action(async (sourceOrOptions: string | { global?: boolean } | undefined, options?: { global?: boolean }) => {
      const source = typeof sourceOrOptions === "string" ? sourceOrOptions : undefined;
      const normalizedOptions = typeof sourceOrOptions === "string" ? options ?? {} : sourceOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      const sources = parseCommaSeparatedValues(source);
      let manifest = await loadManifestOrDefault(layout.rootDir);
      let importedCount = 0;

      if (sources.length === 0) {
        const result = await importSkills(layout, process.cwd());
        manifest = result.manifest;
        importedCount = result.importedCount;
      } else {
        for (const entry of sources) {
          await saveManifest(layout.rootDir, manifest);
          const result = await importSkills(layout, process.cwd(), entry);
          manifest = result.manifest;
          importedCount += result.importedCount;
        }
      }

      await saveManifest(layout.rootDir, manifest);
      printSuccess(`Adopted ${importedCount} skill${importedCount === 1 ? "" : "s"} into ${formatScopeLabel(layout.scope)} skills.yaml`);
    });

    withScopeOption(
      program
        .command("sync")
        .description("Sync the confirmed environment from the machine-local library to targets")
        .argument("[target]", "Target type or comma-separated target types")
        .option("--mode <mode>", "Sync mode: copy or symlink")
    ).action(async (targetOrOptions: string | { mode?: string; global?: boolean } | undefined, options?: { mode?: string; global?: boolean }) => {
      const target = typeof targetOrOptions === "string" ? targetOrOptions : undefined;
      const normalizedOptions = typeof targetOrOptions === "string" ? options ?? {} : targetOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      const state = await inspectProjectState(layout);
      const gateError = getConfirmedStateRequirementError(state, "sync");
      if (gateError) {
        throw new CliError(gateError, 2);
      }
      const manifest = await loadManifest(layout.rootDir);
      const targets = parseCommaSeparatedValues(target);
      if (targets.length === 0) {
        await syncTargets(layout, manifest, { targetType: target, mode: normalizedOptions.mode });
      } else {
        for (const entry of targets) {
          await syncTargets(layout, manifest, { targetType: entry, mode: normalizedOptions.mode });
        }
      }
      printSuccess("Sync complete");
    });

    withScopeOption(
      program
        .command("doctor")
        .description("Check manifest, lockfile, library, pack, targets, and project/global conflicts")
        .option("--json", "Emit a machine-readable report")
    ).action(async (options: { json?: boolean; global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const exitCode = await runDoctor(layout, { json: options.json });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

    await program.parseAsync(argv, { from: "user" });
    return process.exitCode ?? 0;
  } catch (error) {
    if (error instanceof CliError) {
      printError(error.message);
      return error.exitCode;
    }
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function withScopeOption(command: Command): Command {
  return command.option("-g, --global", "Use ~/.skillspm/global instead of the current project");
}

async function runInstallCommand(layout: ReturnType<typeof resolveScopeLayout>, input?: string): Promise<void> {
  const selection = await selectInstallInput(process.cwd(), layout, input);

  if (selection.kind === "manifest") {
    const rootDir = path.dirname(selection.path);
    const manifest = await loadManifestFromPath(selection.path);
    const lockfile = await loadLockfile(rootDir);
    const state = await inspectProjectState({ ...layout, rootDir });
    const result = await installProject(
      { ...layout, rootDir },
      {
        manifest,
        lockfile,
        writeLockfile: isConfirmedProjectState(state)
      }
    );
    await saveManifest(rootDir, result.manifest);
    const installNotice = getInstallStateNotice(state);
    if (installNotice) {
      printInfo(installNotice);
    }
    return;
  }

  const pack = await extractPack(selection.path);
  try {
    const result = await installProject(
      { ...layout, rootDir: pack.rootDir },
      {
        manifest: pack.skillsManifest,
        lockfile: pack.lockfile,
        pack,
        writeLockfile: false
      }
    );
    await saveManifest(layout.rootDir, result.manifest);
    await writeLockfile(layout.rootDir, result.lockfile);
  } finally {
    await pack.cleanup();
  }
}

async function selectInstallInput(
  commandCwd: string,
  layout: ReturnType<typeof resolveScopeLayout>,
  explicitInput?: string
): Promise<InstallSelection> {
  if (explicitInput) {
    const resolvedPath = resolveFileUrlOrPath(commandCwd, explicitInput);
    if (path.basename(resolvedPath) === MANIFEST_FILE) {
      return { kind: "manifest", path: resolvedPath };
    }
    if (resolvedPath.endsWith(".skillspm.tgz")) {
      return { kind: "pack", path: resolvedPath };
    }
    throw new CliError("install input must be an explicit path to skills.yaml or a *.skillspm.tgz pack", 2);
  }

  const manifestPath = path.join(layout.rootDir, MANIFEST_FILE);
  if (await exists(manifestPath)) {
    return { kind: "manifest", path: manifestPath };
  }

  const entries = await listLocalPacks(commandCwd);
  if (entries.length === 1) {
    return { kind: "pack", path: entries[0] };
  }
  if (entries.length > 1) {
    throw new CliError("Multiple local *.skillspm.tgz files found. Pass the pack path explicitly.", 2);
  }

  throw new CliError(
    "No install input found. Pass skills.yaml or a *.skillspm.tgz pack, run inside a project with skills.yaml, or create project intent with `skillspm add <path-or-id>` first.",
    2
  );
}

async function listLocalPacks(cwd: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".skillspm.tgz"))
    .map((entry) => path.join(cwd, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function addSkillToManifest({ commandCwd, layout, manifest, input, provider, bootstrapRemote }: AddSkillOptions): Promise<SkillsManifest> {
  const normalized = await normalizeAddContent(commandCwd, layout, input, provider, bootstrapRemote);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== normalized.id);
  nextSkills.push(normalized);
  return {
    ...manifest,
    skills: nextSkills
  };
}

async function normalizeAddContent(
  commandCwd: string,
  layout: ReturnType<typeof resolveScopeLayout>,
  input: string,
  provider?: string,
  bootstrapRemote = false
): Promise<ManifestSkill> {
  validateProviderName(provider);

  if (looksLikePath(input)) {
    if (provider) {
      throw new CliError("--provider cannot be used with a local path.", 2);
    }
    return addLocalSkill(commandCwd, layout, input);
  }

  const localCandidate = resolveFileUrlOrPath(commandCwd, input);
  if (!provider && (await exists(localCandidate))) {
    return addLocalSkill(commandCwd, layout, input);
  }

  const parsed = parseSkillSpecifier(input);
  const canonicalId = normalizeSkillId(parsed.id, provider);
  if (bootstrapRemote) {
    const bootstrapped = await bootstrapPublicProviderSkill(layout, input, canonicalId, parsed.version);
    if (bootstrapped) {
      const library = await loadLibrary(layout);
      try {
        await cacheSkill(layout, library, bootstrapped.manifestSkill.id, bootstrapped.manifestSkill.version ?? "unversioned", bootstrapped.materializedPath, bootstrapped.source);
      } finally {
        await bootstrapped.cleanup();
      }
      return bootstrapped.manifestSkill;
    }
  }
  return {
    id: canonicalId,
    ...(parsed.version ? { version: parsed.version } : {})
  };
}

async function addLocalSkill(
  commandCwd: string,
  layout: ReturnType<typeof resolveScopeLayout>,
  input: string
): Promise<ManifestSkill> {
  const absolutePath = resolveFileUrlOrPath(commandCwd, input);
  if (!(await exists(absolutePath))) {
    throw new CliError(`Local skill path does not exist: ${input}`, 2);
  }
  if (!(await isDirectory(absolutePath))) {
    throw new CliError(`Local skill path must be a directory: ${input}`, 2);
  }

  const metadata = await loadSkillMetadata(absolutePath);
  const skillId = metadata?.id ?? `local/${path.basename(absolutePath)}`;
  const version = metadata?.version ?? "unversioned";
  const library = await loadLibrary(layout);
  await cacheSkill(layout, library, skillId, version, absolutePath, {
    kind: "local",
    value: absolutePath
  });

  return {
    id: skillId,
    version,
    source: {
      kind: "local",
      value: absolutePath
    }
  };
}

async function loadManifestOrDefault(rootDir: string): Promise<SkillsManifest> {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (await exists(manifestPath)) {
    return loadManifest(rootDir);
  }
  await ensureDir(rootDir);
  const manifest = createDefaultManifest();
  await saveManifest(rootDir, manifest);
  return manifest;
}

async function normalizePackOutputPath(commandCwd: string, output: string): Promise<string> {
  const resolvedPath = resolveFileUrlOrPath(commandCwd, output);
  if (await isDirectory(resolvedPath)) {
    return path.join(resolvedPath, "skills.skillspm.tgz");
  }
  if (!resolvedPath.endsWith(".skillspm.tgz")) {
    return `${resolvedPath}.skillspm.tgz`;
  }
  return resolvedPath;
}

function renderHelp(commandName?: (typeof PUBLIC_COMMANDS)[number]): string {
  if (commandName === "add") {
    return [
      "Usage: skillspm add <content> [options]",
      "",
      "Unified add <content> entrypoint for local paths, GitHub URLs, and provider-backed skill ids",
      "",
      "Auto-detect order:",
      "  1. explicit local path (./, ../, /, file://)",
      "  2. existing local path in the current working directory",
      "  3. https://github.com/... URL",
      "  4. provider-prefixed or plain skill id[@range]",
      "",
      "Provider selection:",
      "  Use --provider <provider> to interpret shorthand or plain ids with a specific provider.",
      "  Ambiguous shorthand such as owner/repo/skill no longer defaults to github.",
      "  Public github: ids and https://github.com/... locators must stay canonical: no credentials, query/fragment, dot segments, encoded separators, backslashes, or empty path segments.",
      "",
      "Examples:",
      "  skillspm add ./skills/my-skill",
      "  skillspm add owner/repo/skill --provider github",
      "  skillspm add https://github.com/owner/repo/tree/main/skills/my-skill",
      "  skillspm add example/skill --provider openclaw",
      "  skillspm add github:owner/repo/skill",
      "  skillspm add openclaw:example/skill@^1.0.0",
      "",
      "Options:",
      "  --provider <provider>  Choose the provider for non-path add input",
      "  --install              Run install after writing skills.yaml",
      "  -g, --global           Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "inspect") {
    return [
      "Usage: skillspm inspect [options]",
      "",
      "Explain the current intent, confirmed state, drift, and next safe actions",
      "",
      "State labels:",
      "  Uninitialized         No skills.yaml intent is present yet",
      "  Development           skills.yaml exists but skills.lock does not",
      "  Drifted Development   skills.yaml changed since the last confirmed skills.lock",
      "  Confirmed             skills.yaml and skills.lock are aligned",
      "",
      "Options:",
      "  --json            Emit a machine-readable state snapshot",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "install") {
    return [
      "Usage: skillspm install [input] [options]",
      "",
      "Consume confirmed state by default, while still materializing current intent locally when unconfirmed",
      "",
      "Install input precedence:",
      "  1. explicit path to skills.yaml or *.skillspm.tgz",
      "  2. current scope skills.yaml",
      "  3. exactly one current-directory *.skillspm.tgz",
      "",
      "Resolution flow:",
      "  1. read desired skills from skills.yaml",
      "  2. use skills.lock to reproduce exact version+digest when available",
      "  3. reuse the machine-local library on exact match",
      "  4. on cache miss, fall back to pack contents, then recorded manifest/library sources",
      "  5. locked provider provenance can re-materialize supported public provider-backed sources (github, openclaw, clawhub, skills.sh) on clean machines when resolved_from.type=provider and resolved_from.ref is a canonical github: id or anonymous https://github.com/... locator",
      "  6. recorded public provider provenance in library.yaml can still supply an exact backing locator for the same narrow public-provider cases",
      "  7. explicit public provider ids (github:, openclaw:, clawhub:, skills.sh:) with exact versions can otherwise re-materialize unauthenticated from public GitHub tag refs",
      "  8. provider recovery rejects symlinks anywhere under the recovered skill root before caching",
      "  9. fail closed on digest mismatch instead of silently accepting drift",
      "",
      "Confirmation behavior:",
      "  Manifest-based install materializes Development and Drifted Development states without creating or rewriting skills.lock.",
      "  Use `skillspm freeze` to confirm a reviewed result.",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "pack") {
    return [
      "Usage: skillspm pack [out] [options]",
      "",
      "Bundle the confirmed environment into a portable supplement for private, local, offline, or recovery workflows",
      "Requires a Confirmed project state; refuses in Development or Drifted Development.",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "freeze") {
    return [
      "Usage: skillspm freeze [options]",
      "",
      "Explicitly refresh skills.lock with exact version, digest, and resolution provenance from the accepted current result",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "adopt") {
    return [
      "Usage: skillspm adopt [source] [options]",
      "",
      "Discover existing skills and merge them into skills.yaml",
      "",
      "Examples:",
      "  skillspm adopt openclaw",
      "  skillspm adopt openclaw,codex",
      "  skillspm adopt ./agent-skills,/opt/shared-skills",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "sync") {
    return [
      "Usage: skillspm sync [target] [options]",
      "",
      "Sync the confirmed environment from the machine-local library to targets",
      "Requires a Confirmed project state; refuses in Development or Drifted Development.",
      "",
      "Examples:",
      "  skillspm sync openclaw",
      "  skillspm sync claude_code",
      "  skillspm sync openclaw,codex",
      "",
      "Options:",
      "  --mode <mode>     Sync mode: copy or symlink",
      "                    [target] accepts openclaw, codex, claude_code, generic, or a comma-separated list",
      "                    Default sync is non-destructive and leaves unmanaged target entries untouched",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "doctor") {
    return [
      "Usage: skillspm doctor [options]",
      "",
      "Check manifest, lockfile, library, pack, targets, and project/global conflicts",
      "",
      "Options:",
      "  --json            Emit a machine-readable report",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "help") {
    return [
      "Usage: skillspm help [command]",
      "",
      "Show top-level or command-specific help"
    ].join("\n");
  }
  return [
    "Usage: skillspm <command> [options]",
    "",
    "Manage declarative, reproducible Skills environments",
    "Default scope: project",
    "",
    "Public commands:",
    "  add               Unified add <content> entrypoint for local paths, GitHub URLs, and provider-backed skill ids",
    "  inspect           Explain current state, drift, and next safe actions",
    "  install           Consume confirmed state by default, while still materializing intent locally when unconfirmed",
    "  pack              Bundle the confirmed environment into a portable recovery supplement",
    "  freeze            Explicitly refresh skills.lock to the accepted current result",
    "  adopt             Discover existing skills and merge them into skills.yaml from [source]",
    "  sync              Sync the confirmed environment from the machine-local library to [target]",
    "  doctor            Check manifest, lockfile, library, pack, targets, and project/global conflicts",
    "  help              Show top-level or command-specific help",
    "",
    "Examples:",
    "  skillspm add ./skills/my-skill --install",
    "  skillspm inspect",
    "  skillspm add owner/repo/skill --provider github",
    "  skillspm adopt openclaw",
    "  skillspm sync claude_code",
    "  skillspm doctor --json",
    "",
    "Run `skillspm help <command>` for command-specific usage."
  ].join("\n");
}

function resolvePublicCommand(commandName: string | undefined): (typeof PUBLIC_COMMANDS)[number] | undefined {
  if (!commandName) {
    return undefined;
  }
  if (REMOVED_PUBLIC_COMMANDS.has(commandName)) {
    throw new CliError(`Unknown command ${commandName}. Run \`skillspm help\` for public commands.`, 2);
  }
  if ((PUBLIC_COMMANDS as readonly string[]).includes(commandName)) {
    return commandName as (typeof PUBLIC_COMMANDS)[number];
  }
  throw new CliError(`Unknown command ${commandName}. Run \`skillspm help\` for public commands.`, 2);
}

function describeManifestSkill(skill: ManifestSkill): string {
  return skill.version ? `${skill.id}@${skill.version}` : skill.id;
}

function parseCommaSeparatedValues(value?: string): string[] {
  if (!value) {
    return [];
  }
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

function parseSkillSpecifier(input: string): { id: string; version?: string } {
  const atIndex = input.lastIndexOf("@");
  if (atIndex > 0 && !input.startsWith("http://") && !input.startsWith("https://")) {
    return {
      id: input.slice(0, atIndex),
      version: input.slice(atIndex + 1)
    };
  }
  return { id: input };
}

function normalizeSkillId(value: string, provider?: string): string {
  const explicitProvider = getExplicitProviderName(value);
  if (explicitProvider) {
    if (explicitProvider === "skillsh") {
      throwUnsupportedSkillshAlias(value);
    }
    if (explicitProvider === "github" && !canonicalizePublicGitHubLocator(value)) {
      throw new CliError(
        `Invalid GitHub skill id: ${value}. Canonical github: ids must not contain credentials, query strings, fragments, dot segments, encoded separators, backslashes, or empty path segments.`,
        2
      );
    }
    return value;
  }

  const githubFromUrl = parseGitHubUrl(value);
  if (githubFromUrl) {
    return githubFromUrl;
  }

  if (looksLikeGitHubUrl(value)) {
    throw new CliError(
      `Invalid GitHub URL: ${value}. Public GitHub locators must be anonymous canonical https://github.com/... URLs without query strings, fragments, dot segments, encoded separators, backslashes, or empty path segments.`,
      2
    );
  }

  if (!provider && looksLikeGitHubShorthand(value)) {
    throw new CliError(
      `Ambiguous add input: ${value}. Choose a provider with --provider <provider> or use an explicit provider-prefixed id such as github:${value.replace(/\.git$/u, "")}.`,
      2
    );
  }

  if (provider) {
    return `${provider}:${value}`;
  }

  return value;
}

function validateProviderName(provider?: string): void {
  if (!provider) {
    return;
  }
  if (provider === "skillsh") {
    throwUnsupportedSkillshAlias(provider);
  }
  if (!/^[a-z][a-z0-9_.-]*$/u.test(provider)) {
    throw new CliError(`Invalid provider name: ${provider}`, 2);
  }
}

function throwUnsupportedSkillshAlias(value: string): never {
  throw new CliError(`Unsupported provider alias: ${value}. Use skills.sh instead.`, 2);
}

function getExplicitProviderName(value: string): string | undefined {
  const match = value.match(/^([a-z][a-z0-9_.-]*):/u);
  if (!match) {
    return undefined;
  }
  return match[1] !== "http" && match[1] !== "https" && match[1] !== "file" ? match[1] : undefined;
}

function hasExplicitProvider(value: string): boolean {
  return getExplicitProviderName(value) !== undefined;
}

function looksLikeGitHubShorthand(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?$/u.test(value);
}

function looksLikeGitHubUrl(value: string): boolean {
  return value.startsWith("https://github.com/") || value.startsWith("http://github.com/");
}

function parseGitHubUrl(value: string): string | undefined {
  if (!value.startsWith("https://github.com/") && !value.startsWith("http://github.com/")) {
    return undefined;
  }
  if (!value.startsWith("https://github.com/")) {
    return undefined;
  }
  return canonicalizePublicGitHubLocator(value);
}

function looksLikePath(value: string): boolean {
  return value.startsWith("file://") || value.startsWith("./") || value.startsWith("../") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
if (executedPath === modulePath) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
