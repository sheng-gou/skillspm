import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { syncTargets } from "./adapter";
import { CliError } from "./errors";
import { importSkills } from "./importer";
import { installProject } from "./installer";
import { loadLockfile } from "./lockfile";
import { createDefaultManifest, loadManifest, saveManifest } from "./manifest";
import { resolveProject } from "./resolver";
import { loadSkillMetadata } from "./skill";
import type { SkillsManifest } from "./types";
import {
  MANIFEST_FILE,
  assertConfiguredPathWithinRoot,
  exists,
  formatSkillVersion,
  normalizeRelativePath,
  printError,
  printInfo,
  printSuccess,
  ensureDir,
  resolveFileUrlOrPath
} from "./utils";
import { runDoctor } from "./doctor";

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
  program.name("skills").description("Manage project-local agent skills");

  program
    .command("init")
    .description("Initialize skills.yaml and .skills/")
    .option("--force", "Overwrite existing skills.yaml")
    .action(async (options: { force?: boolean }) => {
      const cwd = process.cwd();
      const manifestPath = path.join(cwd, MANIFEST_FILE);
      if ((await exists(manifestPath)) && !options.force) {
        throw new CliError("skills.yaml already exists. Run `skills init --force` to overwrite it.", 2);
      }

      const manifest = createDefaultManifest(path.basename(cwd));
      await saveManifest(cwd, manifest);
      await ensureDir(path.join(cwd, ".skills"));
      await ensureGitignoreContains(cwd, ".skills/");

      printSuccess("Initialized Skills project");
      printInfo("  - created skills.yaml");
      printInfo("  - created .skills/");
    });

  program
    .command("add")
    .description("Add a root skill to skills.yaml")
    .argument("<skill>", "Skill id@range or local path")
    .option("--source <name>", "Source name for index-backed skills")
    .option("--install", "Run install after writing skills.yaml")
    .action(async (input: string, options: { source?: string; install?: boolean }) => {
      const cwd = process.cwd();
      const manifest = await loadManifest(cwd);
      const nextManifest = await addSkillToManifest(cwd, manifest, input, options.source);
      await saveManifest(cwd, nextManifest);
      const added = nextManifest.skills[nextManifest.skills.length - 1];
      printSuccess(`Added skill ${describeManifestSkill(added)} to skills.yaml`);
      if (options.install) {
        await installProject(cwd);
      }
    });

  program
    .command("install")
    .description("Resolve and install project skills")
    .action(async () => {
      await installProject(process.cwd());
    });

  program
    .command("import")
    .description("Discover existing skills and merge them into skills.yaml")
    .option("--from <source>", "Scan openclaw, codex, claude_code, or a local path")
    .action(async (options: { from?: string }) => {
      const cwd = process.cwd();
      const result = await importSkills(cwd, options.from);
      await saveManifest(cwd, result.manifest);
      printSuccess(`Imported ${result.importedCount} skill${result.importedCount === 1 ? "" : "s"} into skills.yaml`);
    });

  program
    .command("doctor")
    .description("Check project skills health")
    .action(async () => {
      const exitCode = await runDoctor(process.cwd());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });

  program
    .command("list")
    .description("List root or resolved skills")
    .option("--resolved", "Show the full resolved set")
    .action(async (options: { resolved?: boolean }) => {
      const cwd = process.cwd();
      const manifest = await loadManifest(cwd);
      if (!options.resolved) {
        printInfo("Root skills");
        for (const skill of manifest.skills) {
          process.stdout.write(`- ${skill.id} ${formatSkillVersion(skill.version, Boolean(skill.path))}\n`);
        }
        return;
      }

      let resolved = await loadLockfile(cwd);
      if (!resolved) {
        const resolution = await resolveProject(cwd);
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

      printInfo("Resolved skills");
      for (const [skillId, entry] of Object.entries(resolved.resolved).sort(([left], [right]) => left.localeCompare(right))) {
        process.stdout.write(`- ${skillId} ${entry.version}\n`);
      }
    });

  program
    .command("why")
    .description("Explain why a skill is installed")
    .argument("<skill>", "Skill id")
    .action(async (skillId: string) => {
      const cwd = process.cwd();
      const manifest = await loadManifest(cwd);
      const root = manifest.skills.find((skill) => skill.id === skillId);
      if (root) {
        printInfo(`${skillId} is a root dependency declared in skills.yaml`);
        return;
      }

      const resolution = await resolveProject(cwd);
      if (!resolution.nodes.has(skillId)) {
        throw new CliError(`${skillId} is not part of this project`, 1);
      }

      const chain = findWhyChain(resolution.manifest, resolution.rootSkillIds, resolution.nodes, skillId);
      if (chain.length === 0) {
        throw new CliError(`Unable to determine why ${skillId} is installed`, 1);
      }

      printInfo(`${skillId} is installed because:`);
      printInfo("");
      printInfo(chain.join(" -> "));
    });

  program
    .command("sync")
    .description("Sync installed skills to target directories")
    .argument("[target]", "Target type")
    .option("--mode <mode>", "Sync mode: copy or symlink")
    .action(async (targetOrOptions: string | { mode?: string } | undefined, options?: { mode?: string }) => {
      const target = typeof targetOrOptions === "string" ? targetOrOptions : undefined;
      const normalizedOptions = typeof targetOrOptions === "string" ? options ?? {} : targetOrOptions ?? {};
      const cwd = process.cwd();
      const manifest = await loadManifest(cwd);
      await syncTargets(cwd, manifest, { targetType: target, mode: normalizedOptions.mode });
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

async function addSkillToManifest(
  cwd: string,
  manifest: SkillsManifest,
  input: string,
  sourceName?: string
): Promise<SkillsManifest> {
  const parsed = looksLikePath(input) ? undefined : parseSkillSpecifier(input);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== parsed?.id);

  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(cwd, input);
    assertConfiguredPathWithinRoot(cwd, input, absolutePath, `local skill path ${input}`);
    if (!(await exists(absolutePath))) {
      throw new CliError(`Local skill path does not exist: ${input}`, 2);
    }
    const metadata = await loadSkillMetadata(absolutePath);
    const inferredId = metadata?.id ?? `local/${path.basename(absolutePath)}`;
    const withoutExisting = nextSkills.filter((skill) => skill.id !== inferredId);
    withoutExisting.push({ id: inferredId, path: normalizeRelativePath(cwd, absolutePath) });
    return {
      ...manifest,
      skills: withoutExisting
    };
  } else {
    const skill = { id: parsed.id } as SkillsManifest["skills"][number];
    if (parsed.version) {
      skill.version = parsed.version;
    }
    if (sourceName) {
      skill.source = sourceName;
    }
    nextSkills.push(skill);
  }

  return {
    ...manifest,
    skills: nextSkills
  };
}

function renderHelp(commandName?: string): string {
  if (commandName === "add") {
    return [
      "Usage: skills add <skill> [options]",
      "",
      "Add a root skill to skills.yaml",
      "",
      "Options:",
      "  --source <name>   Source name for index-backed skills",
      "  --install         Run install after writing skills.yaml"
    ].join("\n");
  }
  if (commandName === "install") {
    return ["Usage: skills install", "", "Resolve and install project skills"].join("\n");
  }
  if (commandName === "import") {
    return [
      "Usage: skills import [options]",
      "",
      "Discover existing skills and merge them into skills.yaml",
      "",
      "Options:",
      "  --from <source>   Scan openclaw, codex, claude_code, or a local path"
    ].join("\n");
  }
  if (commandName === "list") {
    return [
      "Usage: skills list [options]",
      "",
      "List root or resolved skills",
      "",
      "Options:",
      "  --resolved        Show the full resolved set"
    ].join("\n");
  }
  if (commandName === "sync") {
    return [
      "Usage: skills sync [target] [options]",
      "",
      "Sync installed skills to target directories",
      "",
      "Options:",
      "  --mode <mode>     Sync mode: copy or symlink"
    ].join("\n");
  }

  return [
    "Usage: skills <command> [options]",
    "",
    "Manage project-local agent skills",
    "",
    "Commands:",
    "  init              Initialize skills.yaml and .skills/",
    "  add               Add a root skill to skills.yaml",
    "  install           Resolve and install project skills",
    "  import            Discover existing skills and merge them into skills.yaml",
    "  doctor            Check project skills health",
    "  list              List root or resolved skills",
    "  why               Explain why a skill is installed",
    "  sync              Sync installed skills to target directories",
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
