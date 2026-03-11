import path from "node:path";
import { CliError } from "./errors";
import type { SkillsLock } from "./types";
import { LOCK_FILE, exists, isResolvedSkillVersion, readDocument, writeYamlDocument } from "./utils";

export async function loadLockfile(cwd: string): Promise<SkillsLock | undefined> {
  const lockPath = path.join(cwd, LOCK_FILE);
  if (!(await exists(lockPath))) {
    return undefined;
  }
  try {
    return validateLockfile(await readDocument<unknown>(lockPath));
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(`skills.lock is invalid:\n- ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}

export async function writeLockfile(cwd: string, lockfile: SkillsLock): Promise<void> {
  const lockPath = path.join(cwd, LOCK_FILE);
  await writeYamlDocument(lockPath, lockfile);
}

function validateLockfile(lockfile: unknown): SkillsLock {
  const value = lockfile as Partial<SkillsLock>;
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    throw new CliError("skills.lock is invalid:\n- expected a YAML object", 2);
  }
  if (value.schema !== "skills-lock/v1") {
    errors.push("schema must be skills-lock/v1");
  }
  if (!value.resolved || typeof value.resolved !== "object" || Array.isArray(value.resolved)) {
    errors.push("resolved must be an object");
  }
  if (typeof value.generated_at !== "string") {
    errors.push("generated_at must be a string");
  }
  if (value.project !== undefined && (typeof value.project !== "object" || value.project === null || Array.isArray(value.project))) {
    errors.push("project must be an object");
  }

  for (const [skillId, entry] of Object.entries(value.resolved ?? {})) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`resolved.${skillId} must be an object`);
      continue;
    }
    if (typeof entry.version !== "string") {
      errors.push(`resolved.${skillId}.version must be a string`);
    } else if (!isResolvedSkillVersion(entry.version)) {
      errors.push(`resolved.${skillId}.version must be an exact semver or "unversioned"`);
    }
    if (entry.dependencies !== undefined && (!Array.isArray(entry.dependencies) || entry.dependencies.some((dependency) => typeof dependency !== "string"))) {
      errors.push(`resolved.${skillId}.dependencies must be an array of strings`);
    }
    if (entry.source !== undefined && (typeof entry.source !== "object" || entry.source === null || Array.isArray(entry.source))) {
      errors.push(`resolved.${skillId}.source must be an object`);
    }
    if (entry.artifact !== undefined && (typeof entry.artifact !== "object" || entry.artifact === null || Array.isArray(entry.artifact))) {
      errors.push(`resolved.${skillId}.artifact must be an object`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(`skills.lock is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return value as SkillsLock;
}
