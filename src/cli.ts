import { Command } from "commander";
import semver from "semver";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import { syncTargets } from "./adapter";
import {
  CANONICAL_PROVIDER_REF_USAGE,
  findMatchingProviderBackedGitSkillVersion,
  loadGitSource,
  providerKindsEqual,
  looksLikeExplicitGitSourceUrl,
  looksLikeCanonicalProviderSkillReference,
  parseCanonicalProviderSkillReference,
  validatePhase1GitSourceUrl
} from "./git-source";
import { loadIndex } from "./index-source";
import { loadLockfile } from "./lockfile";
import { runDoctor } from "./doctor";
import { CliError } from "./errors";
import { buildInspectReport, renderInspectText } from "./inspect-report";
import { importSkills } from "./importer";
import { installProject } from "./installer";
import { createDefaultManifest, loadManifest, saveManifest } from "./manifest";
import { packProject } from "./packer";
import { buildListReport, buildSnapshotReport, freezeInstalledState, renderSnapshotText } from "./report";
import { resolveProject } from "./resolver";
import { formatScopeLabel, resolveScopeLayout, resolveStateContainmentRoot } from "./scope";
import type { ScopeLayout } from "./scope";
import { loadSkillMetadata, validateSkillMetadata } from "./skill";
import type { ManifestSkill, ManifestSource, ManifestTarget, SkillMetadata, SkillsLock, SkillsManifest, TargetType } from "./types";
import {
  MANIFEST_FILE,
  assertConfiguredPathWithinRootReal,
  assertPathWithinRootReal,
  assertSkillRootMarker,
  ensureDir,
  exists,
  formatSkillVersion,
  hasSkillRootMarker,
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
  program.name("skillspm").description("Manage declarative, reproducible Skills environments");

  withScopeOption(
    program
      .command("init")
      .description("Create a starter skills.yaml for the selected scope")
      .option("--force", "Overwrite existing skills.yaml")
  ).action(async (options: { force?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifestPath = path.join(layout.rootDir, MANIFEST_FILE);
    if ((await exists(manifestPath)) && !options.force) {
      throw new CliError(`skills.yaml already exists for ${formatScopeLabel(layout.scope)}. Run \`skillspm init${layout.scope === "global" ? " -g" : ""} --force\` to overwrite it.`, 2);
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
      .description("Add a local, provider-backed, or source-backed root skill to skills.yaml")
      .argument("[skill]", "Skill id@range, canonical skills.sh/clawhub ref, or omit when --from points to one local skill directory")
      .option("--source <name>", "Source name to use or reuse for source-backed skills")
      .option("--from <source>", "Local skill dir or public anonymous HTTPS git repo; explicit local index/catalog is advanced")
      .option("--install", "Run install after writing skills.yaml")
  ).action(
    async (
      skillOrOptions: string | { source?: string; from?: string; install?: boolean; global?: boolean } | undefined,
      options?: { source?: string; from?: string; install?: boolean; global?: boolean }
    ) => {
    const input = typeof skillOrOptions === "string" ? skillOrOptions : undefined;
    const normalizedOptions = typeof skillOrOptions === "string" ? options ?? {} : skillOrOptions ?? {};
    const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
    const manifest = await loadManifest(layout.rootDir);
    const nextManifest = await addSkillToManifest(process.cwd(), layout, manifest, input, {
      sourceName: normalizedOptions.source,
      from: normalizedOptions.from
    });
    await saveManifest(layout.rootDir, nextManifest);
    const added = nextManifest.skills[nextManifest.skills.length - 1];
    printSuccess(`Added skill ${describeManifestSkill(added)} to ${layout.scope} skills.yaml`);
    if (normalizedOptions.install) {
      await runInstallCommand(layout);
    }
  });

  withScopeOption(
    program
      .command("remove")
      .description("Remove a root skill from skills.yaml")
      .argument("<skill>", "Root skill id or local path")
  ).action(async (input: string, options: { global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifest = await loadManifest(layout.rootDir);
    const { nextManifest, removed } = await removeSkillFromManifest(process.cwd(), layout, manifest, input);
    await saveManifest(layout.rootDir, nextManifest);
    printSuccess(`Removed skill ${describeManifestSkill(removed)} from ${layout.scope} skills.yaml`);
  });

  withScopeOption(
    program
      .command("install")
      .description("Resolve skills from local paths, declared sources, and configured exact-version pack restores")
  ).action(async (options: { global?: boolean }) => {
    await runInstallCommand(resolveScopeLayout(process.cwd(), options.global));
  });

  withScopeOption(
    program
      .command("update")
      .description("Refresh installed skills from the current manifest")
      .argument("[skill]", "Optional root skill id or local path")
      .option("--to <version>", "Pin the selected index-backed root skill to an exact version")
  ).action(
    async (
      skillOrOptions: string | { to?: string; global?: boolean } | undefined,
      options?: { to?: string; global?: boolean }
    ) => {
      const input = typeof skillOrOptions === "string" ? skillOrOptions : undefined;
      const normalizedOptions = typeof skillOrOptions === "string" ? options ?? {} : skillOrOptions ?? {};
      const layout = resolveScopeLayout(process.cwd(), normalizedOptions.global);
      await runUpdateCommand(process.cwd(), layout, input, normalizedOptions);
    }
  );

  withScopeOption(
    program
      .command("bootstrap")
      .description("Run install, auto-sync when enabled, then doctor")
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
      .command("freeze")
      .description("Rewrite skills.lock from the currently installed state")
  ).action(async (options: { global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const lockfile = await freezeInstalledState(layout);
    printSuccess(`Updated skills.lock from installed state (${Object.keys(lockfile.resolved).length} skill${Object.keys(lockfile.resolved).length === 1 ? "" : "s"})`);
  });

  withScopeOption(
    program
      .command("pack")
      .description("Write the installed exact skills into a portable directory pack")
      .option("--out <dir>", "Write the directory pack to this path")
  ).action(async (options: { out?: string; global?: boolean }) => {
    if (!options.out) {
      throw new CliError("pack requires --out <dir>", 2);
    }
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const outDir = await normalizePackOutputPath(process.cwd(), layout, options.out);
    const result = await packProject(layout, outDir);
    printSuccess(`Wrote pack to ${result.outDir} (${Object.keys(result.pack.resolved).length} skill${Object.keys(result.pack.resolved).length === 1 ? "" : "s"})`);
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
      .description("Validate manifest, lockfile, installed skills, and targets")
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
      .option("--json", "Emit a machine-readable report")
  ).action(async (options: { resolved?: boolean; json?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const report = await buildListReport(layout, { resolved: options.resolved });

    if (options.json) {
      emitJson(report);
      return;
    }

    printInfo(`${report.view === "resolved" ? "Resolved" : "Root"} skills (${formatScopeLabel(report.scope)})`);
    for (const skill of report.skills) {
      process.stdout.write(`- ${renderListSkillText(skill)}\n`);
    }
  });

  withScopeOption(
    program
      .command("snapshot")
      .description("Summarize the selected skills environment")
      .option("--resolved", "Resolve dependencies live instead of preferring skills.lock")
      .option("--json", "Emit a machine-readable snapshot")
  ).action(async (options: { resolved?: boolean; json?: boolean; global?: boolean }) => {
    const layout = resolveScopeLayout(process.cwd(), options.global);
    const snapshot = await buildSnapshotReport(layout, { resolved: options.resolved });

    if (options.json) {
      emitJson(snapshot);
      return;
    }

    printInfo(renderSnapshotText(snapshot));
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

    const resolution = await resolveProject(layout.rootDir, { stateDir: layout.stateDir });
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

  withScopeOption(
    program
      .command("target")
      .description("Manage sync targets")
      .argument("<action>", "Action to run. Supported: add")
      .argument("[target]", "Target type: openclaw, codex, claude_code, or generic")
      .option("--path <path>", "Set an explicit target path")
  ).action(async (action: string, input: string | undefined, options: { global?: boolean; path?: string }) => {
    if (action !== "add") {
      throw new CliError(`Unknown target action ${action}. Supported: add.`, 2);
    }
    if (!input) {
      throw new CliError("Missing target. Use openclaw, codex, claude_code, or generic.", 2);
    }

    const layout = resolveScopeLayout(process.cwd(), options.global);
    const manifest = await loadManifest(layout.rootDir);
    const targetType = parseTargetType(input);
    const targetPath = options.path ? await normalizeTargetPath(process.cwd(), layout, options.path) : undefined;
    if (targetType === "generic" && !targetPath) {
      throw new CliError("Target generic requires --path.", 2);
    }

    const { nextManifest, changed, updated } = addTargetToManifest(manifest, { type: targetType, path: targetPath });
    if (!changed) {
      printInfo(`Target ${targetType} already exists in ${layout.scope} skills.yaml`);
      return;
    }
    await saveManifest(layout.rootDir, nextManifest);
    printSuccess(`${updated ? "Updated" : "Added"} target ${targetType} in ${layout.scope} skills.yaml`);
  });

  program
    .command("inspect")
    .description("Inspect a local skill directory and generate minimal metadata")
    .argument("<path>", "Skill directory")
    .option("--write", "Write or update skill.yaml in the target directory")
    .option("--set-version <version>", "Override the generated version")
    .option("--json", "Emit a machine-readable report")
    .action(async (input: string, options: { write?: boolean; setVersion?: string; json?: boolean }) => {
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

interface AddSkillOptions {
  sourceName?: string;
  from?: string;
}

type AddFromResolution =
  | {
      kind: "local-skill";
      absolutePath: string;
      metadata?: SkillMetadata;
    }
  | {
      kind: "manifest-source";
      source: Omit<ManifestSource, "name">;
    };

async function addSkillToManifest(
  commandCwd: string,
  layout: ScopeLayout,
  manifest: SkillsManifest,
  input: string | undefined,
  options: AddSkillOptions = {}
): Promise<SkillsManifest> {
  if (options.from) {
    const resolved = await resolveAddFromInput(commandCwd, layout, options.from);
    if (resolved.kind === "local-skill") {
      if (options.sourceName) {
        throw new CliError("--source does not apply when --from points to a local skill directory.", 2);
      }
      validateLocalSingleSkillSelection(input, resolved.metadata, resolved.absolutePath);
      return addLocalPathSkillToManifest(layout, manifest, resolved.absolutePath, resolved.metadata);
    }
    return addSourceBackedSkillToManifest(manifest, input, resolved.source, options.sourceName);
  }

  if (!input) {
    throw new CliError("add requires <skill> or --from <source>.", 2);
  }

  const providerAddInput = await maybeResolveCanonicalProviderAddInput(layout, input);
  if (providerAddInput) {
    return addSourceBackedSkillToManifest(
      manifest,
      providerAddInput.skillId,
      {
        type: "git",
        url: providerAddInput.sourceUrl,
        provider: {
          kind: providerAddInput.providerKind
        }
      },
      options.sourceName,
      providerAddInput.providerRef
    );
  }

  if (options.sourceName && looksLikePath(input)) {
    throw new CliError("--source only applies to source-backed skills.", 2);
  }
  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(commandCwd, input);
    await assertConfiguredPathWithinRootReal(layout.rootDir, input, absolutePath, `local skill path ${input}`);
    if (!(await exists(absolutePath))) {
      throw new CliError(`Local skill path does not exist: ${input}`, 2);
    }
    const metadata = await loadSkillMetadata(absolutePath);
    return addLocalPathSkillToManifest(layout, manifest, absolutePath, metadata);
  }

  const parsed = parseSkillSpecifier(input);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== parsed.id);
  const skill = { id: parsed.id } as SkillsManifest["skills"][number];
  if (parsed.version) {
    skill.version = parsed.version;
  }
  if (options.sourceName) {
    skill.source = options.sourceName;
  }
  nextSkills.push(skill);

  return {
    ...manifest,
    skills: nextSkills
  };
}

interface ResolvedProviderAddInput {
  skillId: string;
  sourceUrl: string;
  providerKind: "skills.sh" | "clawhub";
  providerRef: string;
}

async function maybeResolveCanonicalProviderAddInput(
  layout: ScopeLayout,
  input: string
): Promise<ResolvedProviderAddInput | undefined> {
  const parsed = parseCanonicalProviderSkillReference(input);
  if (typeof parsed === "string") {
    throw new CliError(`Unable to add provider ref ${input}: ${parsed}`, 2);
  }
  if (!parsed) {
    return undefined;
  }

  const previewSource: ManifestSource = {
    name: `provider-preview-${slugSourceName(`${parsed.owner}-${parsed.repo}`)}`,
    type: "git",
    url: parsed.cloneUrl
  };

  let loadedSource;
  try {
    loadedSource = await loadGitSource(path.join(layout.stateDir, "sources", "git"), previewSource);
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(`Unable to resolve provider ref ${parsed.ref}: ${error.message}`, error.exitCode);
    }
    throw error;
  }

  const { skillRoot } = await findMatchingProviderBackedGitSkillVersion(
    loadedSource.path,
    parsed.skill,
    undefined,
    parsed.canonicalRef
  );
  await assertSkillRootMarker(skillRoot, `Provider ref ${parsed.ref}`);

  const metadata = await loadSkillMetadata(skillRoot);
  if (!metadata?.id) {
    throw new CliError(
      `Provider ref ${parsed.ref} resolved to ${path.relative(loadedSource.path, skillRoot) || "."}, but the skill does not declare metadata.id in skill.yaml, so it cannot be added automatically.`,
      2
    );
  }

  return {
    skillId: metadata.id,
    sourceUrl: parsed.cloneUrl,
    providerKind: parsed.provider,
    providerRef: parsed.canonicalRef
  };
}

async function resolveAddFromInput(commandCwd: string, layout: ScopeLayout, from: string): Promise<AddFromResolution> {
  const providerReference = parseCanonicalProviderSkillReference(from);
  if (typeof providerReference === "string") {
    throw new CliError(`Unable to use --from ${from}: ${providerReference}`, 2);
  }
  if (providerReference || looksLikeCanonicalProviderSkillReference(from)) {
    throw new CliError(
      `Explicit skills.sh/clawhub refs are accepted as the <skill> argument, not with --from. Use \`skillspm add skills.sh:owner/repo/skill\`. ${CANONICAL_PROVIDER_REF_USAGE}`,
      2
    );
  }

  if (looksLikeExplicitGitSourceUrl(from)) {
    const sourceUrlError = validatePhase1GitSourceUrl(from);
    if (sourceUrlError) {
      throw new CliError(`Unable to add source from ${from}: ${sourceUrlError}`, 2);
    }
    return {
      kind: "manifest-source",
      source: {
        type: "git",
        url: from.trim()
      }
    };
  }

  const absolutePath = resolveFileUrlOrPath(commandCwd, from);
  await assertConfiguredPathWithinRootReal(layout.rootDir, from, absolutePath, `add source ${from}`);
  if (!(await exists(absolutePath))) {
    throw new CliError(`Source path does not exist: ${from}`, 2);
  }

  if (await isDirectory(absolutePath)) {
    const skillRoot = await hasSkillRootMarker(absolutePath);
    const indexPath = await findLocalIndexPath(absolutePath);

    if (skillRoot && indexPath) {
      throw new CliError(
        `Source path ${from} is ambiguous: it looks like a local skill directory and also contains ${path.basename(indexPath)}. To add the skill, point --from at the exact skill directory you want. To add the index/catalog source, pass --from ${formatExplicitIndexHint(from, indexPath)}.`,
        2
      );
    }

    if (skillRoot) {
      return {
        kind: "local-skill",
        absolutePath,
        metadata: await loadSkillMetadata(absolutePath)
      };
    }

    if (!indexPath) {
      throw new CliError(
        `Source path ${from} must be a local skill directory or contain skills-index.yaml or index.yaml.`,
        2
      );
    }
    return resolveLocalIndexSource(layout, indexPath);
  }

  return resolveLocalIndexSource(layout, absolutePath);
}

async function resolveLocalIndexSource(layout: ScopeLayout, indexPath: string): Promise<AddFromResolution> {
  const normalizedIndexPath = normalizeRelativePath(layout.rootDir, indexPath);
  await loadIndex(normalizedIndexPath, layout.rootDir);
  return {
    kind: "manifest-source",
    source: {
      type: "index",
      url: normalizedIndexPath
    }
  };
}

async function findLocalIndexPath(directoryPath: string): Promise<string | undefined> {
  for (const fileName of ["skills-index.yaml", "index.yaml"]) {
    const candidatePath = path.join(directoryPath, fileName);
    if ((await exists(candidatePath)) && !(await isDirectory(candidatePath))) {
      return candidatePath;
    }
  }
  return undefined;
}

function formatExplicitIndexHint(from: string, indexPath: string): string {
  const trimmed = from.trim();
  if (trimmed.startsWith("file://")) {
    return indexPath;
  }

  const suffix = path.basename(indexPath);
  const normalizedBase = trimmed.replace(/[\\\/]+$/u, "");
  if (normalizedBase === "") {
    return suffix;
  }

  const separator = normalizedBase.includes("\\") ? "\\" : "/";
  return `${normalizedBase}${separator}${suffix}`;
}

function validateLocalSingleSkillSelection(
  input: string | undefined,
  metadata: SkillMetadata | undefined,
  skillPath: string
): void {
  if (!input) {
    return;
  }
  if (looksLikePath(input)) {
    throw new CliError("When --from points to a local skill directory, omit <skill>.", 2);
  }

  const parsed = parseSkillSpecifier(input);
  if (parsed.version) {
    throw new CliError("Version ranges are not used when --from points to a local skill directory.", 2);
  }

  const inferredId = metadata?.id ?? `local/${path.basename(skillPath)}`;
  if (parsed.id !== inferredId) {
    throw new CliError(`Local skill directory provides ${inferredId}, not ${parsed.id}.`, 2);
  }
}

function addLocalPathSkillToManifest(
  layout: ScopeLayout,
  manifest: SkillsManifest,
  absolutePath: string,
  metadata: SkillMetadata | undefined
): SkillsManifest {
  const inferredId = metadata?.id ?? `local/${path.basename(absolutePath)}`;
  const normalizedPath = normalizeRelativePath(layout.rootDir, absolutePath);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== inferredId && skill.path !== normalizedPath);
  nextSkills.push({ id: inferredId, path: normalizedPath });
  return {
    ...manifest,
    skills: nextSkills
  };
}

function addSourceBackedSkillToManifest(
  manifest: SkillsManifest,
  input: string | undefined,
  sourceDraft: Omit<ManifestSource, "name">,
  preferredSourceName?: string,
  providerRef?: string
): SkillsManifest {
  if (!input) {
    throw new CliError("Source-backed add requires <skill>.", 2);
  }
  if (looksLikePath(input)) {
    throw new CliError("When --from points to an index or git source, <skill> must be a skill id or id@range.", 2);
  }
  if (providerRef && (sourceDraft.type !== "git" || !sourceDraft.provider)) {
    throw new CliError("provider_ref can only be used with provider-backed git sources.", 2);
  }

  const parsed = parseSkillSpecifier(input);
  const { sourceName, sources } = upsertManifestSource(manifest, sourceDraft, preferredSourceName);
  const nextSkills = manifest.skills.filter((skill) => skill.id !== parsed.id);
  const nextSkill: ManifestSkill = {
    id: parsed.id,
    ...(parsed.version ? { version: parsed.version } : {}),
    source: sourceName,
    ...(providerRef ? { provider_ref: providerRef } : {})
  };
  nextSkills.push(nextSkill);

  return {
    ...manifest,
    sources,
    skills: nextSkills
  };
}

function upsertManifestSource(
  manifest: SkillsManifest,
  sourceDraft: Omit<ManifestSource, "name">,
  preferredSourceName?: string
): { sourceName: string; sources: ManifestSource[] } {
  const currentSources = [...(manifest.sources ?? [])];
  const existingByDefinition = currentSources.find(
    (source) => source.type === sourceDraft.type
      && source.url === sourceDraft.url
      && providerKindsEqual(source.provider, sourceDraft.provider)
  );
  if (existingByDefinition) {
    return {
      sourceName: existingByDefinition.name,
      sources: currentSources
    };
  }

  if (preferredSourceName) {
    const existingByName = currentSources.find((source) => source.name === preferredSourceName);
    if (
      existingByName
      && (
        existingByName.type !== sourceDraft.type
        || existingByName.url !== sourceDraft.url
        || !providerKindsEqual(existingByName.provider, sourceDraft.provider)
      )
    ) {
      throw new CliError(`Source ${preferredSourceName} already exists with a different definition.`, 2);
    }
    if (existingByName) {
      return {
        sourceName: existingByName.name,
        sources: currentSources
      };
    }
  }

  const sourceName = preferredSourceName ?? createSourceName(currentSources, sourceDraft);
  currentSources.push({ name: sourceName, ...sourceDraft });
  return { sourceName, sources: currentSources };
}

function createSourceName(existingSources: ManifestSource[], sourceDraft: Omit<ManifestSource, "name">): string {
  const baseName = buildSourceNameCandidate(sourceDraft);
  const usedNames = new Set(existingSources.map((source) => source.name));
  let nextName = baseName;
  let counter = 2;
  while (usedNames.has(nextName)) {
    nextName = `${baseName}-${counter}`;
    counter += 1;
  }
  return nextName;
}

function buildSourceNameCandidate(sourceDraft: Omit<ManifestSource, "name">): string {
  if (sourceDraft.type === "git") {
    const providerPrefix = sourceDraft.provider ? `${sourceDraft.provider.kind}-` : "";
    try {
      const parsed = new URL(sourceDraft.url);
      const pathSegments = parsed.pathname
        .replace(/\/+$/u, "")
        .split("/")
        .filter(Boolean)
        .map((segment, index, segments) => index === segments.length - 1 ? segment.replace(/\.git$/iu, "") : segment);
      const detail = pathSegments.slice(-2).join("-") || parsed.hostname;
      return slugSourceName(`git-${providerPrefix}${parsed.hostname}-${detail}`);
    } catch {
      return slugSourceName(`git-${providerPrefix}source`);
    }
  }

  const fileStem = path.basename(sourceDraft.url, path.extname(sourceDraft.url));
  const parentStem = path.basename(path.dirname(sourceDraft.url));
  const detail = fileStem === "index" || fileStem === "skills-index"
    ? (parentStem && parentStem !== "." ? parentStem : fileStem)
    : fileStem;
  return slugSourceName(`index-${detail || "source"}`);
}

function slugSourceName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "source";
}

async function removeSkillFromManifest(
  commandCwd: string,
  layout: ScopeLayout,
  manifest: SkillsManifest,
  input: string
): Promise<{ nextManifest: SkillsManifest; removed: SkillsManifest["skills"][number] }> {
  let removed: SkillsManifest["skills"][number] | undefined;
  const nextSkills: SkillsManifest["skills"] = [];

  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(commandCwd, input);
    for (const skill of manifest.skills) {
      const matches = skill.path && path.resolve(layout.rootDir, skill.path) === path.resolve(absolutePath);
      if (matches && !removed) {
        removed = skill;
        continue;
      }
      nextSkills.push(skill);
    }
  } else {
    const parsed = parseSkillSpecifier(input);
    for (const skill of manifest.skills) {
      if (skill.id === parsed.id && !removed) {
        removed = skill;
        continue;
      }
      nextSkills.push(skill);
    }
  }

  if (!removed) {
    throw new CliError(`Root skill not found: ${input}`, 1);
  }

  return {
    nextManifest: {
      ...manifest,
      skills: nextSkills
    },
    removed
  };
}

function addTargetToManifest(
  manifest: SkillsManifest,
  nextTarget: ManifestTarget
): { nextManifest: SkillsManifest; changed: boolean; updated: boolean } {
  const targets = [...(manifest.targets ?? [])];
  const existingIndex = targets.findIndex((target) => target.type === nextTarget.type);
  if (existingIndex >= 0) {
    const existing = targets[existingIndex];
    const mergedPath = nextTarget.path ?? existing.path;
    const mergedTarget: ManifestTarget = {
      ...existing,
      type: nextTarget.type,
      ...(mergedPath ? { path: mergedPath } : {})
    };
    if (existing.path === mergedTarget.path) {
      return { nextManifest: manifest, changed: false, updated: false };
    }
    targets[existingIndex] = mergedTarget;
    return {
      nextManifest: {
        ...manifest,
        targets
      },
      changed: true,
      updated: true
    };
  }

  targets.push({
    type: nextTarget.type,
    ...(nextTarget.path ? { path: nextTarget.path } : {})
  });
  return {
    nextManifest: {
      ...manifest,
      targets
    },
    changed: true,
    updated: false
  };
}

async function normalizeTargetPath(commandCwd: string, layout: ScopeLayout, input: string): Promise<string> {
  const absolutePath = resolveFileUrlOrPath(commandCwd, input);
  await assertConfiguredPathWithinRootReal(layout.rootDir, input, absolutePath, `target path ${input}`);
  return normalizeRelativePath(layout.rootDir, absolutePath);
}

async function normalizePackOutputPath(commandCwd: string, layout: ScopeLayout, input: string): Promise<string> {
  const absolutePath = resolveFileUrlOrPath(commandCwd, input);
  await assertConfiguredPathWithinRootReal(layout.rootDir, input, absolutePath, `pack output path ${input}`);
  return absolutePath;
}

async function runInstallCommand(layout: ScopeLayout): Promise<void> {
  const result = await installProject(layout);
  if (result.manifest.settings?.auto_sync) {
    await syncTargets(layout, result.manifest);
  }
}

async function runUpdateCommand(
  commandCwd: string,
  layout: ScopeLayout,
  input: string | undefined,
  options: { to?: string }
): Promise<void> {
  const manifest = await loadManifest(layout.rootDir);
  const existingLock = await loadLockfile(layout.rootDir);
  const updatePlan = await prepareManifestForUpdate(commandCwd, layout, manifest, existingLock, input, options.to);

  printInfo("Checking for updates...");
  const result = await installProject(layout, { manifest: updatePlan.installManifest });
  if (updatePlan.persistManifest) {
    await saveManifest(layout.rootDir, updatePlan.persistManifest);
  }
  if (result.manifest.settings?.auto_sync) {
    await syncTargets(layout, result.manifest);
  }

  if (updatePlan.pinnedVersion && updatePlan.selectedSkill) {
    printSuccess(`Pinned ${updatePlan.selectedSkill.id} to ${updatePlan.pinnedVersion} in ${layout.scope} skills.yaml`);
  }

  const changes = diffLockfiles(existingLock, result.lockfile);
  if (changes.length === 0) {
    printInfo(
      updatePlan.selectedSkill
        ? `No updates for ${updatePlan.selectedSkill.id} under current manifest constraints`
        : "No updates available under current manifest constraints"
    );
    return;
  }

  for (const change of changes) {
    printSuccess(renderLockDiff(change));
  }
}

async function prepareManifestForUpdate(
  commandCwd: string,
  layout: ScopeLayout,
  manifest: SkillsManifest,
  existingLock: SkillsLock | undefined,
  input: string | undefined,
  versionOverride?: string
): Promise<{
  installManifest: SkillsManifest;
  persistManifest?: SkillsManifest;
  selectedSkill?: SkillsManifest["skills"][number];
  pinnedVersion?: string;
}> {
  if (!input) {
    if (versionOverride) {
      throw new CliError("--to requires a root skill id or local path.", 2);
    }
    return { installManifest: manifest };
  }

  const selectedIndex = await findManifestSkillIndex(commandCwd, layout, manifest, input);
  if (selectedIndex < 0) {
    throw new CliError(`Root skill not found: ${input}`, 1);
  }

  const selectedSkill = manifest.skills[selectedIndex];
  if (!versionOverride) {
    return {
      installManifest: buildTargetedUpdateManifest(manifest, existingLock, selectedIndex),
      selectedSkill
    };
  }

  if (selectedSkill.path) {
    throw new CliError("--to is only supported for index-backed root skills.", 2);
  }
  const selectedSource = resolveManifestSourceForPin(manifest, selectedSkill);
  if (selectedSource?.type !== "index") {
    throw new CliError("--to is only supported for index-backed root skills.", 2);
  }
  if (semver.valid(versionOverride) !== versionOverride) {
    throw new CliError(`--to requires an exact semver version. Received: ${versionOverride}`, 2);
  }

  const nextSkills = [...manifest.skills];
  nextSkills[selectedIndex] = {
    ...selectedSkill,
    version: versionOverride
  };
  const persistManifest: SkillsManifest = {
    ...manifest,
    skills: nextSkills
  };
  const installManifest = buildTargetedUpdateManifest(persistManifest, existingLock, selectedIndex);

  return {
    installManifest,
    persistManifest,
    selectedSkill: nextSkills[selectedIndex],
    pinnedVersion: versionOverride
  };
}

function buildTargetedUpdateManifest(
  manifest: SkillsManifest,
  existingLock: SkillsLock | undefined,
  selectedIndex: number
): SkillsManifest {
  const nextSkills = manifest.skills.map((skill, index) => {
    if (index === selectedIndex || skill.path) {
      return skill;
    }

    const lockedVersion = existingLock?.resolved[skill.id]?.version;
    if (!canPreserveLockedRootVersion(skill.version, lockedVersion)) {
      return skill;
    }

    return {
      ...skill,
      version: lockedVersion
    };
  });

  const changed = nextSkills.some((skill, index) => skill !== manifest.skills[index]);
  if (!changed) {
    return manifest;
  }

  return {
    ...manifest,
    skills: nextSkills
  };
}

function canPreserveLockedRootVersion(requestedRange: string | undefined, lockedVersion: string | undefined): lockedVersion is string {
  if (!lockedVersion || semver.valid(lockedVersion) !== lockedVersion) {
    return false;
  }
  if (!requestedRange) {
    return true;
  }
  return semver.satisfies(lockedVersion, requestedRange);
}

function resolveManifestSourceForPin(manifest: SkillsManifest, skill: SkillsManifest["skills"][number]): ManifestSource | undefined {
  if (skill.path) {
    return undefined;
  }
  if (skill.source) {
    return manifest.sources?.find((source) => source.name === skill.source);
  }
  const indexSources = (manifest.sources ?? []).filter((source) => source.type === "index");
  return indexSources.length === 1 ? indexSources[0] : undefined;
}

function buildTargetedInstallManifest(
  manifest: SkillsManifest,
  existingLock: SkillsLock | undefined,
  selectedIndex: number
): SkillsManifest {
  if (!existingLock) {
    return manifest;
  }

  let changed = false;
  const nextSkills = manifest.skills.map((skill, index) => {
    if (index === selectedIndex || skill.path) {
      return skill;
    }

    const lockedVersion = existingLock.resolved[skill.id]?.version;
    if (!lockedVersion || lockedVersion === "unversioned") {
      return skill;
    }
    if (skill.version && semver.satisfies(lockedVersion, skill.version) === false) {
      return skill;
    }
    if (skill.version === lockedVersion) {
      return skill;
    }

    changed = true;
    return {
      ...skill,
      version: lockedVersion
    };
  });

  return changed ? { ...manifest, skills: nextSkills } : manifest;
}


async function findManifestSkillIndex(
  commandCwd: string,
  layout: ScopeLayout,
  manifest: SkillsManifest,
  input: string
): Promise<number> {
  if (looksLikePath(input)) {
    const absolutePath = resolveFileUrlOrPath(commandCwd, input);
    return manifest.skills.findIndex((skill) => skill.path && path.resolve(layout.rootDir, skill.path) === path.resolve(absolutePath));
  }

  const parsed = parseSkillSpecifier(input);
  return manifest.skills.findIndex((skill) => skill.id === parsed.id);
}

interface LockDiffRecord {
  id: string;
  before: string | null;
  after: string | null;
}

function diffLockfiles(before: Awaited<ReturnType<typeof loadLockfile>>, after: Awaited<ReturnType<typeof loadLockfile>>): LockDiffRecord[] {
  const previousResolved = before?.resolved ?? {};
  const nextResolved = after?.resolved ?? {};
  const ids = new Set([...Object.keys(previousResolved), ...Object.keys(nextResolved)]);
  return [...ids]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((id) => {
      const previousVersion = previousResolved[id]?.version ?? null;
      const nextVersion = nextResolved[id]?.version ?? null;
      if (previousVersion === nextVersion) {
        return [];
      }
      return [{ id, before: previousVersion, after: nextVersion }];
    });
}

function renderLockDiff(change: LockDiffRecord): string {
  if (change.before === null) {
    return `Added ${change.id}@${change.after}`;
  }
  if (change.after === null) {
    return `Removed ${change.id}@${change.before}`;
  }
  return `Updated ${change.id} ${change.before} -> ${change.after}`;
}

async function inspectSkill(commandCwd: string, input: string, options: { write?: boolean; setVersion?: string; json?: boolean }): Promise<void> {
  const skillRoot = resolveFileUrlOrPath(commandCwd, input);
  if (!(await exists(skillRoot))) {
    throw new CliError(`Skill path does not exist: ${input}`, 2);
  }
  if (!(await isDirectory(skillRoot))) {
    throw new CliError(`Skill path is not a directory: ${input}`, 2);
  }

  const normalizedSkillPath = normalizeRelativePath(commandCwd, skillRoot);
  const skillMarkdownPath = path.join(skillRoot, "SKILL.md");
  if (!(await exists(skillMarkdownPath))) {
    throw new CliError(`SKILL.md is required for ${normalizedSkillPath}. Add it before running inspect.`, 2);
  }

  const metadataPath = path.join(skillRoot, "skill.yaml");
  const existingMetadata = await loadSkillMetadata(skillRoot);
  const nextMetadata = buildInspectableMetadata(skillRoot, existingMetadata, options.setVersion);
  if (options.write) {
    await writeYamlDocument(metadataPath, nextMetadata);
  }

  const report = buildInspectReport(normalizedSkillPath, existingMetadata, nextMetadata, {
    written: options.write,
    versionOverridden: Boolean(options.setVersion)
  });
  report.metadata_path = normalizeRelativePath(commandCwd, metadataPath);
  report.skill_md.path = normalizeRelativePath(commandCwd, skillMarkdownPath);
  report.skill_yaml.path = report.metadata_path;

  if (options.json) {
    emitJson(report);
    return;
  }

  printInfo(renderInspectText(report));
  process.stdout.write(`${renderSkillMetadata(nextMetadata)}\n`);
  if (!options.write) {
    printInfo("");
    printInfo(`Run \`skillspm inspect ${input} --write\` to write skill.yaml.`);
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

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function renderListSkillText(skill: {
  id: string;
  version: string | null;
  version_range: string | null;
  source: string | null;
  path: string | null;
}): string {
  const versionLabel = skill.version ?? skill.version_range ?? "*";
  const details = [];
  if (skill.path) {
    details.push(skill.path);
  }
  if (skill.source && skill.source !== "path") {
    details.push(`source=${skill.source}`);
  }
  return `${skill.id} ${versionLabel}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function renderHelp(commandName?: string): string {
  if (commandName === "init") {
    return [
      "Usage: skillspm init [options]",
      "",
      "Create a starter skills.yaml for the selected scope",
      "",
      "Options:",
      "  --force           Overwrite existing skills.yaml",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "add") {
    return [
      "Usage: skillspm add [skill] [options]",
      "",
      "Add a local, provider-backed, or source-backed root skill to skills.yaml",
      "",
      "Examples:",
      "  skillspm add skills.sh:owner/repo/skill",
      "  skillspm add clawhub:owner/repo/skill",
      "  skillspm add https://skills.sh/owner/repo/skill",
      "",
      "Options:",
      "  --source <name>   Source name to use or reuse for source-backed skills",
      "  --from <source>   Local skill dir or public anonymous HTTPS git repo; explicit local index/catalog is advanced",
      "  --install         Run install after writing skills.yaml",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "remove") {
    return [
      "Usage: skillspm remove <skill> [options]",
      "",
      "Remove a root skill from skills.yaml",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "install") {
    return [
      "Usage: skillspm install [options]",
      "",
      "Resolve skills from local paths, declared sources, and configured exact-version pack restores",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "update") {
    return [
      "Usage: skillspm update [skill] [options]",
      "",
      "Refresh installed skills from the current manifest",
      "",
      "Options:",
      "  --to <version>    Pin the selected index-backed root skill to an exact version",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "bootstrap") {
    return [
      "Usage: skillspm bootstrap [options]",
      "",
      "Run install, auto-sync when enabled, then doctor",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "freeze") {
    return [
      "Usage: skillspm freeze [options]",
      "",
      "Rewrite skills.lock from the currently installed state",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "pack") {
    return [
      "Usage: skillspm pack --out <dir> [options]",
      "",
      "Write the installed exact skills into a portable directory pack",
      "",
      "Options:",
      "  --out <dir>       Write the directory pack to this path",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "import") {
    return [
      "Usage: skillspm import [options]",
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
      "Usage: skillspm doctor [options]",
      "",
      "Validate manifest, lockfile, installed skills, and targets",
      "",
      "Options:",
      "  --json            Emit a machine-readable report",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "list") {
    return [
      "Usage: skillspm list [options]",
      "",
      "List root or resolved skills",
      "",
      "Options:",
      "  --resolved        Show the full resolved set",
      "  --json            Emit a machine-readable report",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "snapshot") {
    return [
      "Usage: skillspm snapshot [options]",
      "",
      "Summarize the selected skills environment",
      "",
      "Options:",
      "  --resolved        Resolve dependencies live instead of preferring skills.lock",
      "  --json            Emit a machine-readable snapshot",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "why") {
    return [
      "Usage: skillspm why <skill> [options]",
      "",
      "Explain why a skill is installed",
      "",
      "Options:",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "sync") {
    return [
      "Usage: skillspm sync [target] [options]",
      "",
      "Sync installed skills to target directories",
      "",
      "Options:",
      "  --mode <mode>     Sync mode: copy or symlink",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "target") {
    return [
      "Usage: skillspm target add <target> [options]",
      "",
      "Manage sync targets",
      "",
      "Commands:",
      "  add <target>      Add openclaw, codex, claude_code, or generic to skills.yaml",
      "",
      "Options:",
      "  --path <path>     Set an explicit target path (required for generic)",
      "  -g, --global      Use ~/.skills instead of the current project"
    ].join("\n");
  }
  if (commandName === "inspect") {
    return [
      "Usage: skillspm inspect <path> [options]",
      "",
      "Inspect a local skill directory and generate minimal metadata",
      "",
      "Options:",
      "  --write           Write or update skill.yaml in the target directory",
      "  --set-version <version>",
      "                    Override the generated version",
      "  --json            Emit a machine-readable report"
    ].join("\n");
  }

  return [
    "Usage: skillspm <command> [options]",
    "",
    "Manage declarative, reproducible Skills environments",
    "Default scope: project (use -g/--global for ~/.skills)",
    "",
    "Core workflow:",
    "  install           Resolve skills from local paths, declared sources, and configured exact-version pack restores",
    "  pack              Write the installed exact skills into a portable directory pack",
    "  freeze            Rewrite skills.lock from the installed state",
    "  sync              Sync installed skills to target directories",
    "  import            Discover existing skills and merge them into skills.yaml",
    "  inspect           Inspect a local skill directory and generate minimal metadata",
    "",
    "Inspection and diagnostics:",
    "  doctor            Validate manifest, lockfile, installed skills, and targets",
    "  list              List root or resolved skills",
    "  snapshot          Summarize the selected skills environment",
    "  why               Explain why a skill is installed",
    "",
    "Manifest helpers:",
    "  init              Create a starter skills.yaml for the selected scope",
    "  add               Add a local or source-backed root skill to skills.yaml",
    "  remove            Remove a root skill from skills.yaml",
    "  target            Manage sync targets",
    "",
    "Other commands:",
    "  update            Refresh installed skills from the current manifest",
    "  bootstrap         Run install, auto-sync when enabled, then doctor",
    "",
    "Run `skillspm <command> --help` for command-specific usage."
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

function parseTargetType(value: string): TargetType {
  if (value === "openclaw" || value === "codex" || value === "claude_code" || value === "generic") {
    return value;
  }
  throw new CliError(`Unknown target ${value}. Use openclaw, codex, claude_code, or generic.`, 2);
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
