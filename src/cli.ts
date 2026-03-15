import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncTargets } from "./adapter";
import { runDoctor } from "./doctor";
import { CliError } from "./errors";
import { importSkills } from "./importer";
import { installProject } from "./installer";
import { loadLockfile, writeLockfile } from "./lockfile";
import { createDefaultManifest, loadManifest, loadManifestFromPath, saveManifest } from "./manifest";
import { extractPack } from "./pack";
import { packProject } from "./packer";
import { resolveProject } from "./resolver";
import { formatScopeLabel, resolveScopeLayout } from "./scope";
import { loadSkillMetadata } from "./skill";
import type { ManifestSkill, SkillsManifest } from "./types";
import {
  MANIFEST_FILE,
  ensureDir,
  exists,
  isDirectory,
  isPathWithinRootReal,
  normalizeRelativePath,
  printError,
  printInfo,
  printSuccess,
  resolveFileUrlOrPath
} from "./utils";

interface InstallSelection {
  kind: "manifest" | "pack";
  path: string;
}

const PUBLIC_COMMANDS = ["add", "install", "pack", "freeze", "adopt", "sync", "doctor", "help"] as const;
const REMOVED_PUBLIC_COMMANDS = new Set(["import", "inspect"]);

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
        .description("Add a root skill to skills.yaml")
        .argument("<skill>", "Skill id[@range] or local path")
        .option("--install", "Run install after writing skills.yaml")
    ).action(async (input: string, options: { install?: boolean; global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const manifest = await loadManifestOrDefault(layout.rootDir);
      const nextManifest = await addSkillToManifest(process.cwd(), layout.rootDir, manifest, input);
      await saveManifest(layout.rootDir, nextManifest);
      const added = nextManifest.skills[nextManifest.skills.length - 1];
      printSuccess(`Added ${describeManifestSkill(added)} to ${formatScopeLabel(layout.scope)} skills.yaml`);
      if (options.install) {
        await runInstallCommand(layout);
      }
    });

    withScopeOption(
      program
        .command("install")
        .description("Resolve a skills environment and cache exact skills locally")
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
        .description("Bundle the current locked environment into a portable pack")
        .argument("[out]", "Output .skillspm.tgz file")
    ).action(async (outOrOptions: string | { global?: boolean } | undefined, options?: { global?: boolean }) => {
      const out = typeof outOrOptions === "string" ? outOrOptions : undefined;
      const normalizedOptions = typeof outOrOptions === "string" ? options ?? {} : outOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      const outFile = await normalizePackOutputPath(process.cwd(), out ?? `${path.basename(layout.rootDir)}.skillspm.tgz`);
      await packProject(layout, outFile);
    });

    withScopeOption(
      program
        .command("freeze")
        .description("Rewrite skills.lock with exact resolved versions")
    ).action(async (options: { global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const resolution = await resolveProject(layout.rootDir);
      const lockfile = {
        schema: "skills-lock/v2" as const,
        skills: Object.fromEntries(
          [...resolution.nodes.values()]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((node) => [node.id, node.version])
        )
      };
      await writeLockfile(layout.rootDir, lockfile);
      printSuccess(`Updated skills.lock (${Object.keys(lockfile.skills).length} skill${Object.keys(lockfile.skills).length === 1 ? "" : "s"})`);
    });

    withScopeOption(
      program
        .command("adopt")
        .description("Discover existing skills and merge them into skills.yaml")
        .option("--from <source>", "Scan openclaw, codex, claude_code, or a local path")
    ).action(async (options: { from?: string; global?: boolean }) => {
      const layout = resolveScopeLayout(process.cwd(), options.global);
      const result = await importSkills(layout, process.cwd(), options.from);
      await saveManifest(layout.rootDir, result.manifest);
      printSuccess(`Adopted ${result.importedCount} skill${result.importedCount === 1 ? "" : "s"} into ${formatScopeLabel(layout.scope)} skills.yaml`);
    });

    withScopeOption(
      program
        .command("sync")
        .description("Sync locked skills from the local library cache to targets")
        .argument("[target]", "Target type")
        .option("--mode <mode>", "Sync mode: copy or symlink")
    ).action(async (targetOrOptions: string | { mode?: string; global?: boolean } | undefined, options?: { mode?: string; global?: boolean }) => {
      const target = typeof targetOrOptions === "string" ? targetOrOptions : undefined;
      const normalizedOptions = typeof targetOrOptions === "string" ? options ?? {} : targetOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      const manifest = await loadManifest(layout.rootDir);
      await syncTargets(layout, manifest, { targetType: target, mode: normalizedOptions.mode });
      printSuccess("Sync complete");
    });

    withScopeOption(
      program
        .command("doctor")
        .description("Check manifest, lockfile, cache, and targets")
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
    await installProject({ ...layout, rootDir }, { manifest, lockfile: await loadLockfile(rootDir) });
    return;
  }

  const pack = await extractPack(selection.path);
  try {
    await installProject(
      { ...layout, rootDir: pack.rootDir },
      {
        manifest: pack.skillsManifest,
        lockfile: pack.lockfile,
        pack,
        writeLockfile: false
      }
    );
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

  throw new CliError("No install input found. Pass skills.yaml or a *.skillspm.tgz pack, or run inside a project with skills.yaml.", 2);
}

async function listLocalPacks(cwd: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".skillspm.tgz"))
    .map((entry) => path.join(cwd, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function addSkillToManifest(
  commandCwd: string,
  manifestRoot: string,
  manifest: SkillsManifest,
  input: string
): Promise<SkillsManifest> {
  const parsed = looksLikePath(input) ? undefined : parseSkillSpecifier(input);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== parsed?.id);

  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(commandCwd, input);
    if (!(await exists(absolutePath))) {
      throw new CliError(`Local skill path does not exist: ${input}`, 2);
    }
    const metadata = await loadSkillMetadata(absolutePath);
    const inferredId = metadata?.id ?? `local/${path.basename(absolutePath)}`;
    const withoutExisting = nextSkills.filter((skill) => skill.id !== inferredId);
    withoutExisting.push({
      id: inferredId,
      path: await toManifestPath(manifestRoot, absolutePath)
    });
    return {
      ...manifest,
      skills: withoutExisting
    };
  }

  nextSkills.push({
    id: parsed!.id,
    ...(parsed!.version ? { version: parsed!.version } : {})
  });
  return {
    ...manifest,
    skills: nextSkills
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

async function toManifestPath(manifestRoot: string, absolutePath: string): Promise<string> {
  if (await isPathWithinRootReal(manifestRoot, absolutePath)) {
    return normalizeRelativePath(manifestRoot, absolutePath);
  }
  return absolutePath;
}

function renderHelp(commandName?: (typeof PUBLIC_COMMANDS)[number]): string {
  if (commandName === "add") {
    return [
      "Usage: skillspm add <skill> [options]",
      "",
      "Add a root skill to skills.yaml",
      "",
      "Options:",
      "  --install         Run install after writing skills.yaml",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "install") {
    return [
      "Usage: skillspm install [input] [options]",
      "",
      "Resolve a skills environment and cache exact skills locally",
      "",
      "Install input precedence:",
      "  1. explicit path to skills.yaml or *.skillspm.tgz",
      "  2. current scope skills.yaml",
      "  3. exactly one current-directory *.skillspm.tgz",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "pack") {
    return [
      "Usage: skillspm pack [out] [options]",
      "",
      "Bundle the current locked environment into a portable pack",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "freeze") {
    return [
      "Usage: skillspm freeze [options]",
      "",
      "Rewrite skills.lock with exact resolved versions",
      "",
      "Options:",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "adopt") {
    return [
      "Usage: skillspm adopt [options]",
      "",
      "Discover existing skills and merge them into skills.yaml",
      "",
      "Options:",
      "  --from <source>   Scan openclaw, codex, claude_code, or a local path",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "sync") {
    return [
      "Usage: skillspm sync [target] [options]",
      "",
      "Sync locked skills from the local library cache to targets",
      "",
      "Options:",
      "  --mode <mode>     Sync mode: copy or symlink",
      "                    Default sync is non-destructive and leaves unmanaged target entries untouched",
      "  -g, --global      Use ~/.skillspm/global instead of the current project"
    ].join("\n");
  }
  if (commandName === "doctor") {
    return [
      "Usage: skillspm doctor [options]",
      "",
      "Check manifest, lockfile, cache, and targets",
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
    "  add               Add a root skill to skills.yaml",
    "  install           Resolve a skills environment and cache exact skills locally",
    "  pack              Bundle the current locked environment into a portable pack",
    "  freeze            Rewrite skills.lock with exact resolved versions",
    "  adopt             Discover existing skills and merge them into skills.yaml",
    "  sync              Sync locked skills from the local library cache to targets",
    "  doctor            Check manifest, lockfile, cache, and targets",
    "  help              Show top-level or command-specific help",
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
  if (skill.path) {
    return `${skill.id} (${skill.path})`;
  }
  return skill.version ? `${skill.id}@${skill.version}` : skill.id;
}

function parseSkillSpecifier(input: string): { id: string; version?: string } {
  const atIndex = input.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      id: input.slice(0, atIndex),
      version: input.slice(atIndex + 1)
    };
  }
  return { id: input };
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
