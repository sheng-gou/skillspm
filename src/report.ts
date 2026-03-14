import path from "node:path";
import { readdir } from "node:fs/promises";
import { resolveDefaultTargetPath } from "./adapter";
import { CliError } from "./errors";
import { loadLockfile, writeLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import { resolveProject } from "./resolver";
import { resolveStateContainmentRoot } from "./scope";
import type { ScopeLayout } from "./scope";
import { loadSkillMetadata } from "./skill";
import type { LockResolvedNode, ManifestSkill, SkillsLock, SkillsManifest } from "./types";
import { buildInstalledEntryName, exists, isResolvedSkillVersion, resolveCleanupRoot, resolveFileUrlOrPath } from "./utils";

export interface ListSkillRecord {
  id: string;
  version: string | null;
  version_range: string | null;
  source: string | null;
  path: string | null;
  status: {
    declared: boolean;
    root: boolean;
    locked: boolean;
    installed: boolean;
    local: boolean;
  };
}

export interface ListReport {
  scope: ScopeLayout["scope"];
  view: "root" | "resolved";
  generated_at: string;
  skills: ListSkillRecord[];
}

export interface SnapshotTargetRecord {
  type: string;
  path: string | null;
  last_synced_path: string | null;
  enabled: boolean;
  configured: boolean;
  mode: string | null;
  status: string | null;
  last_synced_at: string | null;
  entry_count: number | null;
}

export interface SnapshotReport {
  scope: ScopeLayout["scope"];
  root_dir: string;
  state_dir: string;
  installed_root: string;
  generated_at: string;
  resolution_source: "lockfile" | "live" | "none";
  root_skills: ListSkillRecord[];
  resolved_skills: ListSkillRecord[];
  targets: SnapshotTargetRecord[];
}

interface ResolvedSkillRecord extends ListSkillRecord {
  install_entry: string;
}

export async function buildListReport(layout: ScopeLayout, options: { resolved?: boolean } = {}): Promise<ListReport> {
  const manifest = await loadManifest(layout.rootDir);
  const generatedAt = new Date().toISOString();

  if (!options.resolved) {
    return {
      scope: layout.scope,
      view: "root",
      generated_at: generatedAt,
      skills: await buildRootSkillRecords(layout, manifest)
    };
  }

  return {
    scope: layout.scope,
    view: "resolved",
    generated_at: generatedAt,
    skills: (await buildResolvedSkillRecords(layout, manifest)).skills
  };
}

export async function buildSnapshotReport(layout: ScopeLayout, options: { resolved?: boolean } = {}): Promise<SnapshotReport> {
  const manifest = await loadManifest(layout.rootDir);
  const lockfile = await loadLockfile(layout.rootDir);
  const generatedAt = new Date().toISOString();
  const rootSkills = await buildRootSkillRecords(layout, manifest);
  const { skills: resolvedSkills, source } = await buildResolvedSkillRecords(layout, manifest, { preferLive: options.resolved });

  return {
    scope: layout.scope,
    root_dir: layout.rootDir,
    state_dir: layout.stateDir,
    installed_root: layout.installedRoot,
    generated_at: generatedAt,
    resolution_source: source,
    root_skills: rootSkills,
    resolved_skills: resolvedSkills,
    targets: buildTargetRecords(layout, manifest, lockfile)
  };
}

export async function freezeInstalledState(layout: ScopeLayout): Promise<SkillsLock> {
  const manifest = await loadManifest(layout.rootDir);
  await resolveCleanupRoot(layout.installedRoot, {
    containmentRoot: resolveStateContainmentRoot(layout),
    label: `cleanup root ${layout.installedRoot}`
  });
  if (!(await exists(layout.installedRoot))) {
    throw new CliError("No installed skills found. Run `skillspm install` first.", 2);
  }

  const entries = (await readdir(layout.installedRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new CliError("No installed skills found. Run `skillspm install` first.", 2);
  }

  const existingLock = await loadLockfile(layout.rootDir);
  const existingByEntryName = new Map<string, { id: string; node: LockResolvedNode }>();
  for (const [skillId, node] of Object.entries(existingLock?.resolved ?? {})) {
    existingByEntryName.set(buildInstalledEntryName(skillId, node.version), { id: skillId, node });
  }

  const resolved = {} as SkillsLock["resolved"];
  for (const entryName of entries) {
    const installPath = path.join(layout.installedRoot, entryName);
    const metadata = await loadSkillMetadata(installPath);
    const existing = existingByEntryName.get(entryName);
    const inferredVersion = inferVersionFromInstalledEntryName(entryName);
    const skillId = metadata?.id ?? existing?.id ?? inferSkillIdFromInstalledEntryName(entryName);
    const versionCandidate = metadata?.version ?? existing?.node.version ?? inferredVersion ?? "unversioned";
    const version = isResolvedSkillVersion(versionCandidate) ? versionCandidate : "unversioned";

    resolved[skillId] = {
      version,
      source: existing?.node.source ?? { type: "path", url: installPath },
      artifact: existing?.node.artifact ?? { type: "path", url: installPath },
      materialization: existing?.node.materialization ?? { type: "live", path: installPath },
      dependencies: metadata?.dependencies?.map((dependency) => dependency.id) ?? existing?.node.dependencies ?? []
    };
  }

  const lockfile: SkillsLock = {
    schema: "skills-lock/v1",
    project: manifest.project,
    resolved,
    ...(existingLock?.targets ? { targets: existingLock.targets } : {}),
    generated_at: new Date().toISOString()
  };
  await writeLockfile(layout.rootDir, lockfile);
  return lockfile;
}

export function renderSnapshotText(snapshot: SnapshotReport): string {
  const lines = [
    `Skills snapshot (${snapshot.scope})`,
    `Generated: ${snapshot.generated_at}`,
    `Root dir: ${snapshot.root_dir}`,
    `Installed root: ${snapshot.installed_root}`,
    `Resolution source: ${snapshot.resolution_source}`,
    "",
    `Root skills (${snapshot.root_skills.length})`
  ];

  for (const skill of snapshot.root_skills) {
    lines.push(`- ${renderSkillRecord(skill)}`);
  }

  lines.push("", `Resolved skills (${snapshot.resolved_skills.length})`);
  if (snapshot.resolved_skills.length === 0) {
    lines.push("- none");
  } else {
    for (const skill of snapshot.resolved_skills) {
      lines.push(`- ${renderSkillRecord(skill)}`);
    }
  }

  lines.push("", `Targets (${snapshot.targets.length})`);
  for (const target of snapshot.targets) {
    const pathLabel = target.path ?? "(requires explicit path)";
    const details = [
      target.configured ? "configured" : "default",
      target.enabled ? "enabled" : "disabled"
    ];
    if (target.status) {
      details.push(`status=${target.status}`);
    }
    if (target.mode) {
      details.push(`mode=${target.mode}`);
    }
    if (target.last_synced_path && target.last_synced_path !== target.path) {
      details.push(`last_synced_path=${target.last_synced_path}`);
    }
    if (target.last_synced_at) {
      details.push(`last_synced_at=${target.last_synced_at}`);
    }
    if (target.entry_count !== null) {
      details.push(`entries=${target.entry_count}`);
    }
    lines.push(`- ${target.type}: ${pathLabel} [${details.join(", ")}]`);
  }

  return lines.join("\n");
}

async function buildRootSkillRecords(layout: ScopeLayout, manifest: SkillsManifest): Promise<ListSkillRecord[]> {
  const lockfile = await loadLockfile(layout.rootDir);
  const skills: ListSkillRecord[] = [];

  for (const skill of [...manifest.skills].sort((left, right) => left.id.localeCompare(right.id))) {
    const metadataVersion = skill.path ? await readManifestSkillVersion(layout.rootDir, skill) : undefined;
    const lockedNode = lockfile?.resolved[skill.id];
    const resolvedVersion = metadataVersion ?? lockedNode?.version ?? null;
    const installEntry = resolvedVersion ? buildInstalledEntryName(skill.id, resolvedVersion) : null;
    const installed = installEntry ? await exists(path.join(layout.installedRoot, installEntry)) : false;

    skills.push({
      id: skill.id,
      version: skill.path ? resolvedVersion : null,
      version_range: skill.path ? null : skill.version ?? null,
      source: skill.path ? "path" : skill.source ?? null,
      path: skill.path ?? null,
      status: {
        declared: true,
        root: true,
        locked: Boolean(lockedNode),
        installed,
        local: Boolean(skill.path)
      }
    });
  }

  return skills;
}

async function buildResolvedSkillRecords(
  layout: ScopeLayout,
  manifest: SkillsManifest,
  options: { preferLive?: boolean } = {}
): Promise<{ skills: ResolvedSkillRecord[]; source: SnapshotReport["resolution_source"] }> {
  if (!options.preferLive) {
    const lockfile = await loadLockfile(layout.rootDir);
    if (lockfile) {
      return {
        skills: await buildResolvedSkillRecordsFromLock(layout, manifest, lockfile),
        source: "lockfile"
      };
    }
  }

  if (manifest.skills.length === 0) {
    return { skills: [], source: options.preferLive ? "live" : "none" };
  }

  const resolution = await resolveProject(layout.rootDir, { stateDir: layout.stateDir });
  const skills: ResolvedSkillRecord[] = [];
  for (const node of [...resolution.nodes.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const installEntry = buildInstalledEntryName(node.id, node.version);
    skills.push({
      id: node.id,
      version: node.version,
      version_range: null,
      source: node.source?.name ?? node.source?.type ?? null,
      path: selectResolvedNodePath(node.source, node.artifact?.url ?? node.installPath, node.materialization),
      install_entry: installEntry,
      status: {
        declared: resolution.manifest.skills.some((skill) => skill.id === node.id),
        root: node.root,
        locked: false,
        installed: await exists(path.join(layout.installedRoot, installEntry)),
        local: node.source?.type === "path"
      }
    });
  }
  return { skills, source: "live" };
}

async function buildResolvedSkillRecordsFromLock(
  layout: ScopeLayout,
  manifest: SkillsManifest,
  lockfile: SkillsLock
): Promise<ResolvedSkillRecord[]> {
  const skills: ResolvedSkillRecord[] = [];
  for (const [skillId, node] of Object.entries(lockfile.resolved).sort(([left], [right]) => left.localeCompare(right))) {
    const installEntry = buildInstalledEntryName(skillId, node.version);
    skills.push({
      id: skillId,
      version: node.version,
      version_range: null,
      source: node.source?.name ?? node.source?.type ?? null,
      path: selectResolvedNodePath(node.source, node.artifact?.url ?? null, node.materialization),
      install_entry: installEntry,
      status: {
        declared: manifest.skills.some((skill) => skill.id === skillId),
        root: manifest.skills.some((skill) => skill.id === skillId),
        locked: true,
        installed: await exists(path.join(layout.installedRoot, installEntry)),
        local: node.source?.type === "path"
      }
    });
  }
  return skills;
}

function selectResolvedNodePath(
  source: SkillsLock["resolved"][string]["source"] | undefined,
  artifactPath: string | null,
  materialization: SkillsLock["resolved"][string]["materialization"] | undefined
): string | null {
  if (materialization?.type === "pack") {
    return artifactPath;
  }
  if (source?.type === "path") {
    return source.url ?? artifactPath;
  }
  return artifactPath;
}

function buildTargetRecords(layout: ScopeLayout, manifest: SkillsManifest, lockfile?: SkillsLock): SnapshotTargetRecord[] {
  const targets = manifest.targets ?? [];
  const targetStates = lockfile?.targets ?? {};

  if (targets.length === 0) {
    const state = targetStates.openclaw;
    const resolvedPath = resolveDefaultTargetPath("openclaw") ?? null;
    return [{
      type: "openclaw",
      path: resolvedPath,
      last_synced_path: state?.path ?? null,
      enabled: true,
      configured: false,
      mode: state?.mode ?? null,
      status: state?.status ?? null,
      last_synced_at: state?.last_synced_at ?? null,
      entry_count: state?.entry_count ?? null
    }];
  }

  return targets.map((target) => {
    const state = targetStates[target.type];
    const resolvedPath = target.path ? path.resolve(layout.rootDir, target.path) : resolveDefaultTargetPath(target.type) ?? null;
    return {
      type: target.type,
      path: resolvedPath,
      last_synced_path: state?.path ?? null,
      enabled: target.enabled !== false,
      configured: true,
      mode: state?.mode ?? null,
      status: state?.status ?? null,
      last_synced_at: state?.last_synced_at ?? null,
      entry_count: state?.entry_count ?? null
    };
  });
}

async function readManifestSkillVersion(rootDir: string, skill: ManifestSkill): Promise<string | undefined> {
  if (!skill.path) {
    return undefined;
  }
  const skillPath = resolveFileUrlOrPath(rootDir, skill.path);
  const metadata = await loadSkillMetadata(skillPath);
  return metadata?.version;
}

function inferVersionFromInstalledEntryName(entryName: string): string | undefined {
  const atIndex = entryName.lastIndexOf("@");
  if (atIndex <= 0) {
    return undefined;
  }
  const version = entryName.slice(atIndex + 1);
  return isResolvedSkillVersion(version) ? version : undefined;
}

function inferSkillIdFromInstalledEntryName(entryName: string): string {
  const atIndex = entryName.lastIndexOf("@");
  const stem = atIndex > 0 ? entryName.slice(0, atIndex) : entryName;
  return stem.replaceAll("__", "/");
}

function renderSkillRecord(skill: ListSkillRecord): string {
  const versionLabel = skill.version ?? skill.version_range ?? "*";
  const sourceParts = [];
  if (skill.source) {
    sourceParts.push(`source=${skill.source}`);
  }
  if (skill.path) {
    sourceParts.push(`path=${skill.path}`);
  }
  const statusParts = [
    skill.status.root ? "root" : "dep",
    skill.status.installed ? "installed" : "not-installed",
    skill.status.locked ? "locked" : "unlocked"
  ];
  return `${skill.id} ${versionLabel}${sourceParts.length > 0 ? ` (${sourceParts.join(", ")})` : ""} [${statusParts.join(", ")}]`;
}
