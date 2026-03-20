import path from "node:path";
import semver from "semver";
import { loadLockfile } from "./lockfile";
import { loadManifest } from "./manifest";
import type { ScopeLayout } from "./scope";
import type { LockedSkillEntry, LibrarySkillSource, ManifestSkill, SkillsLock, SkillsManifest } from "./types";
import { LOCK_FILE, MANIFEST_FILE, exists, resolveFileUrlOrPath } from "./utils";

export type ProjectStateKind = "uninitialized" | "development" | "confirmed" | "drifted";
export type IntentConfirmedAlignment = "aligned" | "drifted" | "unavailable";

export interface VersionDrift {
  id: string;
  intentVersion: string | null;
  confirmedVersion: string;
}

export interface SourceDrift {
  id: string;
  intentSource: string;
  confirmedSource: string;
}

export interface SourceVerificationGap {
  id: string;
  intentSource: string;
}

export interface IntentConfirmedDrift {
  missingFromLock: string[];
  versionMismatches: VersionDrift[];
  sourceMismatches: SourceDrift[];
  sourceVerificationUnavailable: SourceVerificationGap[];
  extraLockedSkills: string[];
}

export interface NextSafeAction {
  command?: string;
  description: string;
}

export interface ProjectStateSnapshot {
  scope: ScopeLayout["scope"];
  rootDir: string;
  manifestPath: string;
  lockPath: string;
  initialized: boolean;
  manifestPresent: boolean;
  lockPresent: boolean;
  manifestSkillCount: number;
  lockSkillCount: number;
  state: ProjectStateKind;
  alignment: IntentConfirmedAlignment;
  summary: string;
  details: string[];
  drift: IntentConfirmedDrift;
  nextActions: NextSafeAction[];
}

export type ConfirmedStateRequiredCommand = "sync" | "pack";

export async function inspectProjectState(layout: Pick<ScopeLayout, "rootDir" | "scope">): Promise<ProjectStateSnapshot> {
  const manifestPath = path.join(layout.rootDir, MANIFEST_FILE);
  const lockPath = path.join(layout.rootDir, LOCK_FILE);
  const manifestPresent = await exists(manifestPath);
  const lockPresent = await exists(lockPath);

  const manifest = manifestPresent ? await loadManifest(layout.rootDir) : undefined;
  const lockfile = lockPresent ? await loadLockfile(layout.rootDir) : undefined;
  const drift = compareIntentAndConfirmedState(layout.rootDir, manifest, lockfile);

  const state = determineProjectState(manifestPresent, lockPresent, manifest, lockfile, drift);
  return {
    scope: layout.scope,
    rootDir: layout.rootDir,
    manifestPath,
    lockPath,
    initialized: manifestPresent,
    manifestPresent,
    lockPresent,
    manifestSkillCount: manifest?.skills.length ?? 0,
    lockSkillCount: lockfile ? Object.keys(lockfile.skills).length : 0,
    state,
    alignment: drift.alignment,
    summary: buildSummary(state, manifestPresent, lockPresent),
    details: buildDetails(state, manifest, lockfile, drift),
    drift,
    nextActions: buildNextActions(state)
  };
}

export function isConfirmedProjectState(snapshot: Pick<ProjectStateSnapshot, "state">): boolean {
  return snapshot.state === "confirmed";
}

export function describeProjectState(state: ProjectStateKind): string {
  if (state === "uninitialized") {
    return "Uninitialized";
  }
  if (state === "development") {
    return "Development";
  }
  if (state === "drifted") {
    return "Drifted Development";
  }
  return "Confirmed";
}

export function getConfirmedStateRequirementError(
  snapshot: Pick<ProjectStateSnapshot, "state" | "summary">,
  command: ConfirmedStateRequiredCommand
): string | undefined {
  if (snapshot.state === "confirmed") {
    return undefined;
  }

  const stateLabel = describeProjectState(snapshot.state);
  if (snapshot.state === "uninitialized") {
    return `Refusing to ${command} from ${stateLabel}. ${snapshot.summary} Create intent with \`skillspm add <path-or-id>\` or restore a confirmed environment with \`skillspm install <pack.skillspm.tgz>\` first.`;
  }
  if (snapshot.state === "development") {
    return `Refusing to ${command} from ${stateLabel}. ${snapshot.summary} Run \`skillspm install\` to materialize the current intent locally, review it, then run \`skillspm freeze\` before retrying.`;
  }
  return `Refusing to ${command} from ${stateLabel}. ${snapshot.summary} Run \`skillspm inspect\` to review the drift, then \`skillspm freeze\` to confirm the current result before retrying.`;
}

export function getInstallStateNotice(snapshot: Pick<ProjectStateSnapshot, "state">): string | undefined {
  if (snapshot.state === "development") {
    return "Installed the current intent into the local library. skills.lock was not written; this project remains in Development until you run `skillspm freeze`.";
  }
  if (snapshot.state === "drifted") {
    return "Installed the current intent into the local library. skills.lock was not rewritten; the confirmed state is still stale relative to skills.yaml. Run `skillspm inspect` or `skillspm freeze` after review.";
  }
  return undefined;
}

function compareIntentAndConfirmedState(
  rootDir: string,
  manifest: SkillsManifest | undefined,
  lockfile: SkillsLock | undefined
): IntentConfirmedDrift & { alignment: IntentConfirmedAlignment } {
  const drift: IntentConfirmedDrift = {
    missingFromLock: [],
    versionMismatches: [],
    sourceMismatches: [],
    sourceVerificationUnavailable: [],
    extraLockedSkills: []
  };

  if (!manifest || !lockfile) {
    return {
      alignment: "unavailable",
      ...drift
    };
  }

  const manifestIds = new Set(manifest.skills.map((skill) => skill.id));
  drift.extraLockedSkills = Object.keys(lockfile.skills)
    .filter((skillId) => !manifestIds.has(skillId))
    .sort((left, right) => left.localeCompare(right));

  for (const skill of manifest.skills) {
    const locked = lockfile.skills[skill.id];
    if (!locked) {
      drift.missingFromLock.push(skill.id);
      continue;
    }

    if (!lockedVersionSatisfies(skill.version, locked.version)) {
      drift.versionMismatches.push({
        id: skill.id,
        intentVersion: skill.version ?? null,
        confirmedVersion: locked.version
      });
    }

    const sourceComparison = compareSkillSource(rootDir, skill, locked);
    if (sourceComparison.type === "mismatch") {
      drift.sourceMismatches.push({
        id: skill.id,
        intentSource: sourceComparison.intentSource,
        confirmedSource: sourceComparison.confirmedSource
      });
    }
    if (sourceComparison.type === "unavailable") {
      drift.sourceVerificationUnavailable.push({
        id: skill.id,
        intentSource: sourceComparison.intentSource
      });
    }
  }

  const drifted = drift.missingFromLock.length > 0
    || drift.versionMismatches.length > 0
    || drift.sourceMismatches.length > 0
    // Fail closed when the lock cannot prove comparable source provenance.
    || drift.sourceVerificationUnavailable.length > 0
    || (manifest.skills.length === 0 && Object.keys(lockfile.skills).length > 0);

  return {
    alignment: drifted ? "drifted" : "aligned",
    ...drift
  };
}

function determineProjectState(
  manifestPresent: boolean,
  lockPresent: boolean,
  manifest: SkillsManifest | undefined,
  lockfile: SkillsLock | undefined,
  drift: { alignment: IntentConfirmedAlignment }
): ProjectStateKind {
  if (!manifestPresent) {
    return "uninitialized";
  }
  if (!lockPresent) {
    return "development";
  }
  if ((manifest?.skills.length ?? 0) === 0 && Object.keys(lockfile?.skills ?? {}).length > 0) {
    return "drifted";
  }
  return drift.alignment === "aligned" ? "confirmed" : "drifted";
}

function buildSummary(state: ProjectStateKind, manifestPresent: boolean, lockPresent: boolean): string {
  if (state === "uninitialized") {
    return lockPresent
      ? "skills.lock exists, but there is no current project intent in skills.yaml."
      : "This directory is not initialized yet. No project intent has been recorded in skills.yaml.";
  }
  if (state === "development") {
    return "skills.yaml defines intent, but there is no confirmed state in skills.lock yet.";
  }
  if (state === "drifted") {
    return "skills.yaml and skills.lock diverge. You are in Drifted Development until you confirm the new result.";
  }
  return manifestPresent
    ? "skills.yaml and skills.lock are aligned. This project has a confirmed reproducible state."
    : "skills.yaml and skills.lock are aligned.";
}

function buildDetails(
  state: ProjectStateKind,
  manifest: SkillsManifest | undefined,
  lockfile: SkillsLock | undefined,
  drift: IntentConfirmedDrift
): string[] {
  const details: string[] = [];
  const manifestCount = manifest?.skills.length ?? 0;
  const lockCount = lockfile ? Object.keys(lockfile.skills).length : 0;

  if (state === "uninitialized") {
    if (lockfile) {
      details.push(`skills.lock is present with ${pluralize(lockCount, "locked skill")}, but skills.yaml is missing.`);
    }
    return details;
  }

  details.push(`skills.yaml lists ${pluralize(manifestCount, "intent skill")}.`);
  if (lockfile) {
    details.push(`skills.lock records ${pluralize(lockCount, "confirmed skill")}.`);
  } else {
    details.push("No confirmed state is recorded yet.");
  }

  if (state === "drifted") {
    for (const skillId of drift.missingFromLock) {
      details.push(`${skillId} is present in skills.yaml but missing from skills.lock.`);
    }
    for (const mismatch of drift.versionMismatches) {
      details.push(`${mismatch.id} wants ${describeIntentVersion(mismatch.intentVersion)} in skills.yaml but skills.lock confirms ${mismatch.confirmedVersion}.`);
    }
    for (const mismatch of drift.sourceMismatches) {
      details.push(`${mismatch.id} points to ${mismatch.intentSource} in skills.yaml but skills.lock confirms ${mismatch.confirmedSource}.`);
    }
    if (manifestCount === 0 && lockCount > 0) {
      details.push("skills.yaml is empty, but skills.lock still confirms previously frozen skills.");
    }
  }

  if (drift.sourceVerificationUnavailable.length > 0) {
    details.push(`Source drift could not be fully verified for ${pluralize(drift.sourceVerificationUnavailable.length, "skill")} because the current lock entry does not record comparable source provenance.`);
  }

  if (drift.extraLockedSkills.length > 0) {
    details.push(`skills.lock also contains ${pluralize(drift.extraLockedSkills.length, "additional locked skill")} beyond the manifest roots; these may be retained dependencies from the last confirmed result.`);
  }

  return details;
}

function buildNextActions(state: ProjectStateKind): NextSafeAction[] {
  if (state === "uninitialized") {
    return [
      {
        command: "skillspm add <path-or-id>",
        description: "Create project intent in skills.yaml."
      },
      {
        command: "skillspm install <pack.skillspm.tgz>",
        description: "Restore a project from a pack when you do not have local intent yet."
      }
    ];
  }

  if (state === "development") {
    return [
      {
        command: "skillspm install",
        description: "Materialize the current intent without changing skills.lock."
      },
      {
        command: "skillspm freeze",
        description: "Confirm the reviewed result and write a new skills.lock."
      }
    ];
  }

  if (state === "drifted") {
    return [
      {
        command: "skillspm install",
        description: "Materialize the updated intent without rewriting skills.lock."
      },
      {
        command: "skillspm freeze",
        description: "Confirm the updated result once you have reviewed it."
      }
    ];
  }

  return [
    {
      command: "skillspm install",
      description: "Reproduce the confirmed environment from the current intent and lock."
    },
    {
      command: "skillspm sync",
      description: "Apply the confirmed environment to configured targets."
    },
    {
      command: "skillspm pack",
      description: "Bundle the confirmed environment for recovery or transfer."
    }
  ];
}

function lockedVersionSatisfies(intentVersion: string | undefined, confirmedVersion: string): boolean {
  if (intentVersion === undefined) {
    return true;
  }
  if (intentVersion === "unversioned" || confirmedVersion === "unversioned") {
    return intentVersion === confirmedVersion;
  }
  return semver.valid(confirmedVersion) !== null && semver.validRange(intentVersion) !== null
    ? semver.satisfies(confirmedVersion, intentVersion)
    : intentVersion === confirmedVersion;
}

function compareSkillSource(
  rootDir: string,
  skill: ManifestSkill,
  locked: LockedSkillEntry
):
  | { type: "match" }
  | { type: "mismatch"; intentSource: string; confirmedSource: string }
  | { type: "unavailable"; intentSource: string } {
  if (!skill.source) {
    return { type: "match" };
  }

  const intentSource = describeIntentSource(rootDir, skill.source);
  const comparableRef = getComparableSourceRef(rootDir, skill.source);
  if (!locked.resolved_from) {
    return { type: "unavailable", intentSource };
  }

  if (locked.resolved_from.type !== skill.source.kind || locked.resolved_from.ref !== comparableRef) {
    return {
      type: "mismatch",
      intentSource,
      confirmedSource: `${locked.resolved_from.type}:${locked.resolved_from.ref}`
    };
  }

  return { type: "match" };
}

function describeIntentSource(rootDir: string, source: LibrarySkillSource): string {
  if (source.kind === "provider") {
    const ref = source.provider?.ref ?? source.value;
    return `${source.kind}:${ref}`;
  }
  return `${source.kind}:${resolveFileUrlOrPath(rootDir, source.value)}`;
}

function getComparableSourceRef(rootDir: string, source: LibrarySkillSource): string {
  if (source.kind === "provider") {
    return source.provider?.ref ?? source.value;
  }
  return resolveFileUrlOrPath(rootDir, source.value);
}

function describeIntentVersion(version: string | null): string {
  return version ?? "any available version";
}

function pluralize(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
