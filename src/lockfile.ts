import path from "node:path";
import type { SkillsLock } from "./types";
import { CliError } from "./errors";
import { LOCK_FILE, ensureDir, exists, isResolvedSkillVersion, readDocument, writeYamlDocument } from "./utils";

const ALLOWED_LOCKFILE_KEYS = new Set(["schema", "skills"]);

export async function loadLockfile(cwd: string): Promise<SkillsLock | undefined> {
  return loadLockfileFromPath(path.join(cwd, LOCK_FILE));
}

export async function loadLockfileFromPath(lockPath: string): Promise<SkillsLock | undefined> {
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
  const orderedSkills = Object.fromEntries(
    Object.entries(lockfile.skills).sort(([left], [right]) => left.localeCompare(right))
  );
  await ensureDir(cwd);
  await writeYamlDocument(path.join(cwd, LOCK_FILE), {
    schema: "skills-lock/v2",
    skills: orderedSkills
  });
}

export function validateLockfile(lockfile: unknown): SkillsLock {
  const value = lockfile as Partial<SkillsLock> & Record<string, unknown>;
  const errors: string[] = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("skills.lock is invalid:\n- expected a YAML object", 2);
  }
  if (value.schema !== "skills-lock/v2") {
    errors.push("schema must be skills-lock/v2");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_LOCKFILE_KEYS.has(key)) {
      errors.push(`unknown top-level key ${key}; allowed keys: schema, skills`);
    }
  }
  if (!value.skills || typeof value.skills !== "object" || Array.isArray(value.skills)) {
    errors.push("skills must be an object");
  }

  for (const [skillId, version] of Object.entries(value.skills ?? {})) {
    if (typeof version !== "string") {
      errors.push(`skills.${skillId} must be a string`);
      continue;
    }
    if (!isResolvedSkillVersion(version)) {
      errors.push(`skills.${skillId} must be an exact semver or "unversioned"`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(`skills.lock is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return {
    schema: "skills-lock/v2",
    skills: Object.fromEntries(Object.entries(value.skills ?? {}).sort(([left], [right]) => left.localeCompare(right)))
  };
}
