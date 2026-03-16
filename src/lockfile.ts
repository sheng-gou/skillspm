import path from "node:path";
import type { LockedSkillEntry, LockedSkillResolvedFrom, ResolvedSkillNode, SkillsLock } from "./types";
import { CliError } from "./errors";
import { LOCK_FILE, ensureDir, exists, hashDirectoryContents, isResolvedSkillVersion, readDocument, writeYamlDocument } from "./utils";

const ALLOWED_LOCKFILE_KEYS = new Set(["schema", "skills"]);
const ALLOWED_LOCKED_SKILL_KEYS = new Set(["version", "digest", "resolved_from"]);
const ALLOWED_RESOLVED_FROM_KEYS = new Set(["type", "ref"]);
const ALLOWED_RESOLVED_FROM_TYPES = new Set<LockedSkillResolvedFrom["type"]>(["cache", "pack", "local", "target", "provider"]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

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
    Object.entries(lockfile.skills)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([skillId, entry]) => [skillId, formatLockedSkillEntry(entry)])
  );
  await ensureDir(cwd);
  await writeYamlDocument(path.join(cwd, LOCK_FILE), {
    schema: "skills-lock/v3",
    skills: orderedSkills
  });
}

export function validateLockfile(lockfile: unknown): SkillsLock {
  const value = lockfile as Partial<SkillsLock> & Record<string, unknown>;
  const errors: string[] = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("skills.lock is invalid:\n- expected a YAML object", 2);
  }
  if (value.schema !== "skills-lock/v2" && value.schema !== "skills-lock/v3") {
    errors.push("schema must be skills-lock/v2 or skills-lock/v3");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_LOCKFILE_KEYS.has(key)) {
      errors.push(`unknown top-level key ${key}; allowed keys: schema, skills`);
    }
  }
  if (!value.skills || typeof value.skills !== "object" || Array.isArray(value.skills)) {
    errors.push("skills must be an object");
  }

  const normalizedSkills: Record<string, LockedSkillEntry> = {};
  for (const [skillId, rawEntry] of Object.entries(value.skills ?? {})) {
    const normalized = validateLockedSkillEntry(value.schema, skillId, rawEntry, errors);
    if (normalized) {
      normalizedSkills[skillId] = normalized;
    }
  }

  if (errors.length > 0) {
    throw new CliError(`skills.lock is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return {
    schema: value.schema as SkillsLock["schema"],
    skills: Object.fromEntries(Object.entries(normalizedSkills).sort(([left], [right]) => left.localeCompare(right)))
  };
}

export function buildLockfileFromNodes(nodes: Iterable<ResolvedSkillNode>): SkillsLock {
  return {
    schema: "skills-lock/v3",
    skills: Object.fromEntries(
      [...nodes]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node) => [
          node.id,
          {
            version: node.version,
            digest: node.digest,
            resolved_from: node.resolvedFrom
          }
        ])
    )
  };
}

export async function verifyLockedSkillPathIdentity(
  skillId: string,
  entry: LockedSkillEntry,
  targetPath: string,
  label: string
): Promise<string> {
  const digest = await hashDirectoryContents(targetPath);
  if (entry.digest && digest !== entry.digest) {
    throw new CliError(
      `${label} for ${skillId}@${entry.version} failed closed: digest mismatch (skills.lock=${entry.digest}, actual=${digest}).`,
      4
    );
  }
  return digest;
}

function validateLockedSkillEntry(
  schema: SkillsLock["schema"] | undefined,
  skillId: string,
  rawEntry: unknown,
  errors: string[]
): LockedSkillEntry | undefined {
  const entryErrors: string[] = [];
  if (schema === "skills-lock/v2") {
    if (typeof rawEntry !== "string") {
      errors.push(`skills.${skillId} must be a string in skills-lock/v2`);
      return undefined;
    }
    if (!isResolvedSkillVersion(rawEntry)) {
      errors.push(`skills.${skillId} must be an exact semver or "unversioned"`);
      return undefined;
    }
    return { version: rawEntry };
  }

  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    errors.push(`skills.${skillId} must be an object with version, digest, and resolved_from`);
    return undefined;
  }

  for (const key of Object.keys(rawEntry as Record<string, unknown>)) {
    if (!ALLOWED_LOCKED_SKILL_KEYS.has(key)) {
      entryErrors.push(`skills.${skillId} has unknown key ${key}; allowed keys: version, digest, resolved_from`);
    }
  }

  const value = rawEntry as Partial<LockedSkillEntry> & Record<string, unknown>;
  if (typeof value.version !== "string") {
    entryErrors.push(`skills.${skillId}.version must be a string`);
  } else if (!isResolvedSkillVersion(value.version)) {
    entryErrors.push(`skills.${skillId}.version must be an exact semver or "unversioned"`);
  }

  if (typeof value.digest !== "string") {
    entryErrors.push(`skills.${skillId}.digest must be a string`);
  } else if (!DIGEST_PATTERN.test(value.digest)) {
    entryErrors.push(`skills.${skillId}.digest must be a sha256:<hex> digest`);
  }

  if (!value.resolved_from || typeof value.resolved_from !== "object" || Array.isArray(value.resolved_from)) {
    entryErrors.push(`skills.${skillId}.resolved_from must be an object with type and ref`);
  } else {
    const resolvedFrom = value.resolved_from as Partial<LockedSkillResolvedFrom> & Record<string, unknown>;
    for (const key of Object.keys(resolvedFrom)) {
      if (!ALLOWED_RESOLVED_FROM_KEYS.has(key)) {
        entryErrors.push(`skills.${skillId}.resolved_from has unknown key ${key}; allowed keys: type, ref`);
      }
    }
    if (typeof resolvedFrom.type !== "string") {
      entryErrors.push(`skills.${skillId}.resolved_from.type must be a string`);
    } else if (!ALLOWED_RESOLVED_FROM_TYPES.has(resolvedFrom.type as LockedSkillResolvedFrom["type"])) {
      entryErrors.push(`skills.${skillId}.resolved_from.type must be one of: cache, pack, local, target, provider`);
    }
    if (typeof resolvedFrom.ref !== "string") {
      entryErrors.push(`skills.${skillId}.resolved_from.ref must be a string`);
    }
  }

  if (entryErrors.length > 0) {
    errors.push(...entryErrors);
    return undefined;
  }

  return {
    version: value.version as string,
    digest: value.digest as string,
    resolved_from: value.resolved_from as LockedSkillResolvedFrom
  };
}

function formatLockedSkillEntry(entry: LockedSkillEntry): Record<string, unknown> {
  return {
    version: entry.version,
    ...(entry.digest ? { digest: entry.digest } : {}),
    ...(entry.resolved_from ? { resolved_from: entry.resolved_from } : {})
  };
}
