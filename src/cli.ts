import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import { syncTargets } from "./adapter";
import { runDoctor } from "./doctor";
import { CliError } from "./errors";
import { importSkills } from "./importer";
import { installProject } from "./installer";
import { loadLockfile } from "./lockfile";
import { createDefaultManifest, loadManifest, saveManifest } from "./manifest";
import { resolveProject } from "./resolver";
import { formatScopeLabel, resolveScopeLayout, resolveStateContainmentRoot } from "./scope";
import type { ScopeLayout } from "./scope";
import { loadSkillMetadata, validateSkillMetadata } from "./skill";
import type { SkillMetadata, SkillsManifest } from "./types";
import {
  MANIFEST_FILE,
  assertConfiguredPathWithinRootReal,
  assertPathWithinRootReal,
  ensureDir,
  exists,
  formatSkillVersion,
  isDirectory,
  normalizeRelativePath,
  printError,
  printInfo,
  printSuccess,
  resolveFileUrlOrPath,
  writeYamlDocument
} from "./utils";

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printInfo(renderHelp());
    return 0;
  }
  if (argv.length >= 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    printInfo(renderHelp(argv[0]));
    return 0;
  }

  const program = new Command();
  program.name("skills").description("Manage reproducible agent skills environments");

  withScopeOption(
    program
      .command("init")
      .description("Initialize skills.yaml and the local install root")
      .option("--force", "Overwrite existing skills.yaml")
  ).action(async (options: { force?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifestPath = path.join(layout.rootDir, MANIFEST_FILE);
    if ((await exists(manifestPath)) && !options.force) {
      throw new CliError(`skills.yaml already exists for ${formatScopeLabel(layout.scope)}. Run \`skills init${layout.scope === "global" ? " -g" : ""} --force\` to overwrite it.`, 2);
    }

    await ensureDir(layout.rootDir);
    const manifest = createDefaultManifest(layout.scope === "global" ? "global" : path.basename(layout.rootDir));
    await saveManifest(layout.rootDir, manifest);
    await assertPathWithinRootReal(resolveStateContainmentRoot(layout), layout.stateDir, `state root ${layout.stateDir}`);
    await ensureDir(layout.stateDir);
    if (layout.scope === "global") {
      await assertPathWithinRootReal(resolveStateContainmentRoot(layout), layout.installedRoot, `installed root ${layout.installedRoot}`);
      await ensureDir(layout.installedRoot);
    } else {
      await ensureGitignoreContains(layout.rootDir, ".skills/");
    }

    printSuccess(`Initialized Skills ${layout.scope} scope`);
    printInfo(`  - manifest: ${manifestPath}`);
    printInfo(`  - state: ${layout.stateDir}`);
    if (layout.scope === "global") {
      printInfo(`  - installed: ${layout.installedRoot}`);
    }
  });

  withScopeOption(
    program
      .command("add")
      .description("Add a root skill to skills.yaml")
      .argument("<skill>", "Skill id@range or local path")
      .option("--source <name>", "Source name for index-backed skills")
      .option("--install", "Run install after writing skills.yaml")
  ).action(async (input: string, options: { source?: string; install?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifest = await loadManifest(layout.rootDir);
    const nextManifest = await addSkillToManifest(process.cwd(), layout, manifest, input, options.source);
    await saveManifest(layout.rootDir, nextManifest);
    const added = nextManifest.skills[nextManifest.skills.length - 1];
    printSuccess(`Added skill ${describeManifestSkill(added)} to ${layout.scope} skills.yaml`);
    if (options.install) {
      await runInstallCommand(layout);
    }
  });

  withScopeOption(
    program
      .command("install")
      .description("Resolve and install skills into the selected scope")
  ).action(async (options: { global?: boolean }) => {
    await runInstallCommand(resolveScopeLayout(process.cwd(), options.global));
  });

  withScopeOption(
    program
      .command("bootstrap")
      .description("Install, optionally auto-sync, then run doctor")
  ).action(async (options: { global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    await runInstallCommand(layout);
    const exitCode = await runDoctor(layout);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

  withScopeOption(
    program
      .command("import")
      .description("Discover existing skills and merge them into skills.yaml")
      .option("--from <source>", "Scan openclaw, codex, claude_code, or a local path")
  ).action(async (options: { from?: string; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const result = await importSkills(layout, process.cwd(), options.from);
    await saveManifest(layout.rootDir, result.manifest);
    printSuccess(`Imported ${result.importedCount} skill${result.importedCount === 1 ? "" : "s"} into ${layout.scope} skills.yaml`);
  });

  withScopeOption(
    program
      .command("doctor")
      .description("Check skills health")
      .option("--json", "Emit a machine-readable report")
  ).action(async (options: { json?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const exitCode = await runDoctor(layout, { json: options.json });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

  withScopeOption(
    program
      .command("list")
      .description("List root or resolved skills")
      .option("--resolved", "Show the full resolved set")
  ).action(async (options: { resolved?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifest = await loadManifest(layout.rootDir);
    if (!options.resolved) {
      printInfo(`Root skills (${formatScopeLabel(layout.scope)})`);
      for (const skill of manifest.skills) {
        process.stdout.write(`- ${skill.id} ${formatSkillVersion(skill.version, Boolean(skill.path))}\n`);
      }
      return;
    }

    let resolved = await loadLockfile(layout.rootDir);
    if (!resolved) {
      const resolution = await resolveProject(layout.rootDir);
      resolved = {
        schema: "skills-lock/v1",
        project: resolution.manifest.project,
        resolved: [...resolution.nodes.values()].reduce<Record<string, { version: string; dependencies?: string[] }>>(
          (accumulator, node) => {
            accumulator[node.id] = {
              version: node.version,
              dependencies: node.dependencies.map((dependency) => dependency.id)
            };
            return accumulator;
          },
          {}
        ),
        generated_at: new Date().toISOString()
      };
    }

    printInfo(`Resolved skills (${formatScopeLabel(layout.scope)})`);
    for (const [skillId, entry] of Object.entries(resolved.resolved).sort(([left], [right]) => left.localeCompare(right))) {
      process.stdout.write(`- ${skillId} ${entry.version}\n`);
    }
  });

  withScopeOption(
    program
      .command("why")
      .description("Explain why a skill is installed")
      .argument("<skill>", "Skill id")
  ).action(async (skillId: string, options: { global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifest = await loadManifest(layout.rootDir);
    const root = manifest.skills.find((skill) => skill.id === skillId);
    if (root) {
      printInfo(`${skillId} is a root dependency declared in ${layout.scope} skills.yaml`);
      return;
    }

    const resolution = await resolveProject(layout.rootDir);
    if (!resolution.nodes.has(skillId)) {
      throw new CliError(`${skillId} is not part of this ${layout.scope} scope`, 1);
    }

    const chain = findWhyChain(resolution.manifest, resolution.rootSkillIds, resolution.nodes, skillId);
    if (chain.length === 0) {
      throw new CliError(`Unable to determine why ${skillId} is installed`, 1);
    }

    printInfo(`${skillId} is installed because:`);
    printInfo("");
    printInfo(chain.join(" -> "));
  });

  withScopeOption(
    program
      .command("sync")
      .description("Sync installed skills to target directories")
      .argument("[target]", "Target type")
      .option("--mode <mode>", "Sync mode: copy or symlink")
  ).action(async (targetOrOptions: string | { mode?: string; global?: boolean } | undefined, options?: { mode?: string; global?: boolean }) => {
    const target = typeof targetOrOptions === "string" ? targetOrOptions : undefined;
    const normalizedOptions = typeof targetOrOptions === "string" ? options ?? {} : targetOrOptions ?? {};
    const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
    const manifest = await loadManifest(layout.rootDir);
    await syncTargets(layout, manifest, { targetType: target, mode: normalizedOptions.mode });
  });

  program
    .command("inspect")
    .description("Inspect a local skill directory and generate minimal metadata")
    .argument("<path>", "Skill directory")
    .option("--write", "Write or update skill.yaml in the target directory")
    .option("--set-version <version>", "Override the generated version")
    .action(async (input: string, options: { write?: boolean; setVersion?: string }) => {
      await inspectSkill(process.cwd(), input, options);
    });

  try {
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
  return command.option("-g, --global", "Use ~/.skills instead of the current project");
}

async function addSkillToManifest(
  commandCwd: string,
  layout: ScopeLayout,
  manifest: SkillsManifest,
  input: string,
  sourceName?: string
): Promise<SkillsManifest> {
  const parsed = looksLikePath(input) ? undefined : parseSkillSpecifier(input);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== parsed?.id);

  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(commandCwd, input);
    await assertConfiguredPathWithinRootReal(layout.rootDir, input, absolutePath, `local skill path ${input}`);
    if (!(await exists(absolutePath))) {
      throw new CliError(`Local skill path does not exist: ${input}`, 2);
    }
    const metadata = await loadSkillMetadata(absolutePath);
    const inferredId = metadata?.id ?? `local/${path.basename(absolutePath)}`;
    const withoutExisting = nextSkills.filter((skill) => skill.id !== inferredId);
    withoutExisting.push({ id: inferredId, path: normalizeRelativePath(layout.rootDir, absolutePath) });
    return {
      ...manifest,
      skills: withoutExisting
    };
  }

  const skill = { id: parsed.id } as SkillsManifest["skills"][number];
  if (parsed.version) {
    skill.version = parsed.version;
  }
  if (sourceName) {
    skill.source = sourceName;
  }
  nextSkills.push(skill);

  return {
    ...manifest,
    skills: nextSkills
  };
}

async function runInstallCommand(layout: ScopeLayout): Promise<void> {
  const result = await installProject(layout);
  if (result.manifest.settings?.auto_sync) {
    await syncTargets(layout, result.manifest);
  }
}

async function inspectSkill(commandCwd: string, input: string, options: { write?: boolean; setVersion?: string }): Promise<void> {
  const skillRoot = resolveFileUrlOrPath(commandCwd, input);
  if (!(await exists(skillRoot))) {
    throw new CliError(`Skill path does not exist: ${input}`, 2);
  }
  if (!(await isDirectory(skillRoot))) {
    throw new CliError(`Skill path is not a directory: ${input}`, 2);
  }

  const metadataPath = path.join(skillRoot, "skill.yaml");
  const existingMetadata = await loadSkillMetadata(skillRoot);
  const nextMetadata = buildInspectableMetadata(skillRoot, existingMetadata, options.setVersion);
  const hasSkillMarkdown = await exists(path.join(skillRoot, "SKILL.md"));

  printInfo(`Inspecting ${normalizeRelativePath(commandCwd, skillRoot)}`);
  printInfo(`- skill.yaml: ${(await exists(metadataPath)) ? "present" : "missing"}`);
  printInfo(`- SKILL.md: ${hasSkillMarkdown ? "present" : "missing (doctor will fail after install until you add it)"}`);

  if (options.write) {
    await writeYamlDocument(metadataPath, nextMetadata);
    printSuccess(`Wrote ${normalizeRelativePath(commandCwd, metadataPath)}`);
  } else {
    printInfo("Preview:");
  }

  process.stdout.write(`${renderSkillMetadata(nextMetadata)}\n`);
  if (!options.write) {
    printInfo("");
    printInfo(`Run \`skills inspect ${input} --write\` to write skill.yaml.`);
  }
}

function buildInspectableMetadata(skillRoot: string, existingMetadata: SkillMetadata | undefined, setVersion?: string): SkillMetadata {
  const folderName = path.basename(skillRoot);
  return validateSkillMetadata(
    {
      ...existingMetadata,
      schema: "skill/v1",
      id: existingMetadata?.id ?? folderName,
      name: existingMetadata?.name ?? folderName,
      version: setVersion ?? existingMetadata?.version ?? "0.1.0",
      package: {
        type: existingMetadata?.package?.type ?? "dir",
        entry: existingMetadata?.package?.entry ?? "./"
      },
      dependencies: existingMetadata?.dependencies ?? []
    },
    `generated metadata for ${skillRoot}`
  );
}

function renderSkillMetadata(metadata: SkillMetadata): string {
  return stringifyYaml(metadata, {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0
  }).trimEnd();
}

function renderHelp(commandName?: string): string {
  if (commandName === "init") {
    return [
      "Usage: skills init [options]",
      "",
      "Initialize skills.yaml and the local install root",
      "",
      "Options:",
      "  --force           Overwrite existing skills.yaml",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "add") {
    return [
      "Usage: skills add <skill> [options]",
      "",
      "Add a root skill to skills.yaml",
      "",
      "Options:",
      "  --source <name>   Source name for index-backed skills",
      "  --install         Run install after writing skills.yaml",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "install") {
    return [
      "Usage: skills install [options]",
      "",
      "Resolve and install skills into the selected scope",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "bootstrap") {
    return [
      "Usage: skills bootstrap [options]",
      "",
      "Install, optionally auto-sync, then run doctor",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "import") {
    return [
      "Usage: skills import [options]",
      "",
      "Discover existing skills and merge them into skills.yaml",
      "",
      "Options:",
      "  --from <source>   Scan openclaw, codex, claude_code, or a local path",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "doctor") {
    return [
      "Usage: skills doctor [options]",
      "",
      "Check skills health",
      "",
      "Options:",
      "  --json            Emit a machine-readable report",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "list") {
    return [
      "Usage: skills list [options]",
      "",
      "List root or resolved skills",
      "",
      "Options:",
      "  --resolved        Show the full resolved set",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "why") {
    return [
      "Usage: skills why <skill> [options]",
      "",
      "Explain why a skill is installed",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "sync") {
    return [
      "Usage: skills sync [target] [options]",
      "",
      "Sync installed skills to target directories",
      "",
      "Options:",
      "  --mode <mode>     Sync mode: copy or symlink",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "inspect") {
    return [
      "Usage: skills inspect <path> [options]",
      "",
      "Inspect a local skill directory and generate minimal metadata",
      "",
      "Options:",
      "  --write           Write or update skill.yaml in the target directory",
      "  --set-version <version>",
      "                    Override the generated version"
    ].join("\n");
  }

  return [
    "Usage: skills <command> [options]",
    "",
    "Manage reproducible agent skills environments",
    "Default scope: project (use -g/--global for ~/.skills)",
    "",
    "Commands:",
    "  init              Initialize skills.yaml and the selected install root",
    "  add               Add a root skill to skills.yaml",
    "  install           Resolve and install skills into the selected scope",
    "  bootstrap         Install, optionally auto-sync, then run doctor",
    "  import            Discover existing skills and merge them into skills.yaml",
    "  doctor            Check skills health",
    "  list              List root or resolved skills",
    "  why               Explain why a skill is installed",
    "  sync              Sync installed skills to target directories",
    "  inspect           Inspect a local skill directory and generate minimal metadata",
    "",
    "Run `skills <command> --help` for command-specific usage."
  ].join("\n");
}

function describeManifestSkill(skill: SkillsManifest["skills"][number]): string {
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

function findWhyChain(
  manifest: SkillsManifest,
  rootIds: string[],
  nodes: Map<string, { dependencies: { id: string }[] }>,
  targetId: string
): string[] {
  const queue: string[][] = rootIds
    .filter((rootId) => manifest.skills.some((skill) => skill.id === rootId))
    .map((rootId) => [rootId]);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const chain = queue.shift()!;
    const current = chain[chain.length - 1];
    if (current === targetId) {
      return chain;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const node = nodes.get(current);
    for (const dependency of node?.dependencies ?? []) {
      queue.push([...chain, dependency.id]);
    }
  }

  return [];
}

async function ensureGitignoreContains(cwd: string, line: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, `${line}\n`, "utf8");
    return;
  }

  const current = await readFile(gitignorePath, "utf8");
  const lines = new Set(current.split(/\r?\n/).filter(Boolean));
  if (!lines.has(line)) {
    const suffix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
    await writeFile(gitignorePath, `${current}${suffix}${line}\n`, "utf8");
  }
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
if (executedPath === modulePath) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
