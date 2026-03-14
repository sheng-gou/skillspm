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
  const normalizedProject = canonicalizeProjectMetadata(lockfile.project);
  const normalizedLockfile = {
    ...lockfile,
    ...(normalizedProject !== undefined ? { project: normalizedProject } : {})
  } as SkillsLock;
  if (normalizedProject === undefined) {
    delete (normalizedLockfile as Partial<SkillsLock>).project;
  }
  await writeYamlDocument(lockPath, normalizedLockfile);
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
  if (value.targets !== undefined && (typeof value.targets !== "object" || value.targets === null || Array.isArray(value.targets))) {
    errors.push("targets must be an object");
  }
  if (typeof value.generated_at !== "string") {
    errors.push("generated_at must be a string");
  }
  const project = normalizeLockfileProject(value.project, errors);

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
    } else if (entry.source) {
      if (entry.source.type !== "index" && entry.source.type !== "git" && entry.source.type !== "path") {
        errors.push(`resolved.${skillId}.source.type has unsupported value`);
      }
      if (entry.source.name !== undefined && typeof entry.source.name !== "string") {
        errors.push(`resolved.${skillId}.source.name must be a string`);
      }
      if (entry.source.url !== undefined && typeof entry.source.url !== "string") {
        errors.push(`resolved.${skillId}.source.url must be a string`);
      }
      if (entry.source.revision !== undefined && typeof entry.source.revision !== "string") {
        errors.push(`resolved.${skillId}.source.revision must be a string`);
      }
    }
    if (entry.artifact !== undefined && (typeof entry.artifact !== "object" || entry.artifact === null || Array.isArray(entry.artifact))) {
      errors.push(`resolved.${skillId}.artifact must be an object`);
    } else if (entry.artifact) {
      if (entry.artifact.type !== "path") {
        errors.push(`resolved.${skillId}.artifact.type must be path`);
      }
      if (entry.artifact.url !== undefined && typeof entry.artifact.url !== "string") {
        errors.push(`resolved.${skillId}.artifact.url must be a string`);
      }
    }
    if (entry.materialization !== undefined && (typeof entry.materialization !== "object" || entry.materialization === null || Array.isArray(entry.materialization))) {
      errors.push(`resolved.${skillId}.materialization must be an object`);
    } else if (entry.materialization) {
      if (entry.materialization.type !== "live" && entry.materialization.type !== "pack") {
        errors.push(`resolved.${skillId}.materialization.type has unsupported value`);
      }
      if (entry.materialization.path !== undefined && typeof entry.materialization.path !== "string") {
        errors.push(`resolved.${skillId}.materialization.path must be a string`);
      }
      if (entry.materialization.pack !== undefined && typeof entry.materialization.pack !== "string") {
        errors.push(`resolved.${skillId}.materialization.pack must be a string`);
      }
      if (entry.materialization.entry !== undefined && typeof entry.materialization.entry !== "string") {
        errors.push(`resolved.${skillId}.materialization.entry must be a string`);
      }
    }
  }

  for (const [targetName, target] of Object.entries(value.targets ?? {})) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      errors.push(`targets.${targetName} must be an object`);
      continue;
    }

    const normalizedEntryCount = typeof target.entry_count === "string" && /^\d+$/.test(target.entry_count)
      ? Number(target.entry_count)
      : target.entry_count;
    if (normalizedEntryCount !== undefined) {
      target.entry_count = normalizedEntryCount;
    }

    if (target.type !== "openclaw" && target.type !== "codex" && target.type !== "claude_code" && target.type !== "generic") {
      errors.push(`targets.${targetName}.type has unsupported value`);
    }
    if (typeof target.path !== "string") {
      errors.push(`targets.${targetName}.path must be a string`);
    }
    if (target.configured_path !== undefined && typeof target.configured_path !== "string") {
      errors.push(`targets.${targetName}.configured_path must be a string`);
    }
    if (typeof target.enabled !== "boolean") {
      errors.push(`targets.${targetName}.enabled must be a boolean`);
    }
    if (target.mode !== "copy" && target.mode !== "symlink") {
      errors.push(`targets.${targetName}.mode must be copy or symlink`);
    }
    if (target.status !== "synced") {
      errors.push(`targets.${targetName}.status must be synced`);
    }
    if (typeof target.last_synced_at !== "string") {
      errors.push(`targets.${targetName}.last_synced_at must be a string`);
    }
    if (normalizedEntryCount !== undefined && (typeof normalizedEntryCount !== "number" || !Number.isInteger(normalizedEntryCount) || normalizedEntryCount < 0)) {
      errors.push(`targets.${targetName}.entry_count must be a non-negative integer`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(`skills.lock is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  const normalizedLockfile = {
    ...value,
    ...(project !== undefined ? { project } : {})
  } as SkillsLock;
  if (project === undefined) {
    delete (normalizedLockfile as Partial<SkillsLock>).project;
  }
  return normalizedLockfile;
}

function normalizeLockfileProject(project: unknown, errors: string[]): SkillsLock["project"] | undefined {
  if (project === undefined) {
    return undefined;
  }
  if (typeof project === "string") {
    return { name: project };
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    errors.push("project must be an object");
    return undefined;
  }
  const value = project as { name?: unknown };
  if (value.name !== undefined && typeof value.name !== "string") {
    errors.push("project.name must be a string");
    return undefined;
  }
  return value.name === undefined ? {} : { name: value.name };
}

function canonicalizeProjectMetadata(project: unknown): SkillsLock["project"] | undefined {
  if (project === undefined) {
    return undefined;
  }
  if (typeof project === "string") {
    return { name: project };
  }
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return undefined;
  }
  const value = project as { name?: unknown };
  if (value.name !== undefined && typeof value.name !== "string") {
    return undefined;
  }
  return value.name === undefined ? {} : { name: value.name };
}
