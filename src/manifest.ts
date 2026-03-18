import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { LibrarySkillSource, ManifestSkill, ManifestTarget, SkillsManifest } from "./types";
import { MANIFEST_FILE, ensureDir, exists, readDocument, writeYamlDocument } from "./utils";

const SUPPORTED_RANGE_PATTERN = /^(?:\d+\.\d+\.\d+|\^\d+\.\d+\.\d+|~\d+\.\d+\.\d+|unversioned)$/;
const ALLOWED_MANIFEST_KEYS = new Set(["skills", "targets"]);
const ALLOWED_SKILL_KEYS = new Set(["id", "version", "source"]);
const ALLOWED_TARGET_KEYS = new Set(["type", "enabled", "path"]);
const ALLOWED_LIBRARY_SOURCE_KINDS = new Set<LibrarySkillSource["kind"]>(["local", "target", "provider"]);
const ALLOWED_SOURCE_KEYS = new Set(["kind", "value", "provider"]);
const ALLOWED_PROVIDER_KEYS = new Set(["name", "ref", "visibility"]);

export function isSupportedVersionRange(value: string): boolean {
  if (value === "unversioned") {
    return true;
  }
  return SUPPORTED_RANGE_PATTERN.test(value) && semver.validRange(value) !== null;
}

export function validateManifest(manifest: unknown): SkillsManifest {
  const errors: string[] = [];
  const value = manifest as Partial<SkillsManifest> & Record<string, unknown>;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("skills.yaml must be a YAML object", 2);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      errors.push(`unknown top-level key ${key}; allowed keys: skills, targets`);
    }
  }
  if (!Array.isArray(value.skills)) {
    errors.push("skills must be an array");
  }
  if (value.targets !== undefined && !Array.isArray(value.targets)) {
    errors.push("targets must be an array");
  }

  const rootIds = new Set<string>();
  for (const skill of value.skills ?? []) {
    validateManifestSkill(skill, errors);
    if (typeof skill?.id === "string") {
      if (rootIds.has(skill.id)) {
        errors.push(`duplicate root skill id ${skill.id}`);
      }
      rootIds.add(skill.id);
    }
  }

  for (const target of value.targets ?? []) {
    validateTarget(target, errors);
  }

  if (errors.length > 0) {
    throw new CliError(`skills.yaml is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return value as SkillsManifest;
}

function validateManifestSkill(skill: Partial<ManifestSkill>, errors: string[]): void {
  if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
    errors.push("skills entries must be objects");
    return;
  }
  for (const key of Object.keys(skill as Record<string, unknown>)) {
    if (!ALLOWED_SKILL_KEYS.has(key)) {
      errors.push(`skill ${skill.id ?? "<unknown>"} has unknown key ${key}; allowed keys: id, version, source`);
    }
  }
  if (!skill.id || typeof skill.id !== "string") {
    errors.push("skill.id must be a string");
  }
  if (skill.version !== undefined) {
    if (typeof skill.version !== "string") {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be a string`);
    } else if (!isSupportedVersionRange(skill.version)) {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be exact, caret, tilde, or unversioned`);
    }
  }
  if (skill.source !== undefined) {
    validateManifestSkillSource(`skill ${skill.id ?? "<unknown>"}.source`, skill.source, errors);
  }
}

function validateManifestSkillSource(label: string, source: unknown, errors: string[]): void {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push(`${label} must be an object with kind and value strings`);
    return;
  }

  const raw = source as { kind?: unknown; value?: unknown; provider?: unknown } & Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_SOURCE_KEYS.has(key)) {
      errors.push(`${label} has unknown key ${key}; allowed keys: kind, value, provider`);
    }
  }
  if (typeof raw.kind !== "string") {
    errors.push(`${label}.kind must be a string`);
  } else if (!ALLOWED_LIBRARY_SOURCE_KINDS.has(raw.kind as LibrarySkillSource["kind"])) {
    errors.push(`${label}.kind must be one of: local, target, provider`);
  }
  if (typeof raw.value !== "string") {
    errors.push(`${label}.value must be a string`);
  }
  if ("provider" in raw && raw.provider !== undefined) {
    if (!raw.provider || typeof raw.provider !== "object" || Array.isArray(raw.provider)) {
      errors.push(`${label}.provider must be an object`);
      return;
    }
    const provider = raw.provider as { name?: unknown; ref?: unknown; visibility?: unknown } & Record<string, unknown>;
    for (const key of Object.keys(provider)) {
      if (!ALLOWED_PROVIDER_KEYS.has(key)) {
        errors.push(`${label}.provider has unknown key ${key}; allowed keys: name, ref, visibility`);
      }
    }
    if (typeof provider.name !== "string") {
      errors.push(`${label}.provider.name must be a string`);
    }
    if ("ref" in provider && provider.ref !== undefined && typeof provider.ref !== "string") {
      errors.push(`${label}.provider.ref must be a string`);
    }
    if ("visibility" in provider && provider.visibility !== undefined && typeof provider.visibility !== "string") {
      errors.push(`${label}.provider.visibility must be a string`);
    }
  }
}

function validateTarget(target: Partial<ManifestTarget>, errors: string[]): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    errors.push("targets entries must be objects");
    return;
  }
  for (const key of Object.keys(target as Record<string, unknown>)) {
    if (!ALLOWED_TARGET_KEYS.has(key)) {
      errors.push(`target ${target.type ?? "<unknown>"} has unknown key ${key}; allowed keys: type, enabled, path`);
    }
  }
  if (!target.type || !["openclaw", "codex", "claude_code", "generic"].includes(target.type)) {
    errors.push(`target ${target.type ?? "<unknown>"} has unsupported type`);
  }
  if (target.enabled !== undefined && typeof target.enabled !== "boolean") {
    errors.push(`target ${target.type ?? "<unknown>"} enabled must be a boolean`);
  }
  if (target.path !== undefined && typeof target.path !== "string") {
    errors.push(`target ${target.type ?? "<unknown>"} path must be a string`);
  }
}

export async function loadManifest(cwd: string): Promise<SkillsManifest> {
  return loadManifestFromPath(path.join(cwd, MANIFEST_FILE));
}

export async function loadManifestFromPath(manifestPath: string): Promise<SkillsManifest> {
  if (!(await exists(manifestPath))) {
    throw new CliError("skills.yaml not found.", 2);
  }
  return validateManifest(await readDocument<unknown>(manifestPath));
}

export async function saveManifest(cwd: string, manifest: SkillsManifest): Promise<void> {
  const manifestPath = path.join(cwd, MANIFEST_FILE);
  await ensureDir(path.dirname(manifestPath));
  const validated = validateManifest(manifest);
  await writeYamlDocument(manifestPath, {
    skills: validated.skills.map((skill) => formatManifestSkill(skill)),
    ...(validated.targets === undefined ? {} : { targets: validated.targets })
  });
}

function formatManifestSkill(skill: ManifestSkill): Record<string, unknown> {
  return {
    id: skill.id,
    ...(skill.version === undefined ? {} : { version: skill.version }),
    ...(skill.source === undefined
      ? {}
      : {
          source: {
            kind: skill.source.kind,
            value: skill.source.value,
            ...(skill.source.provider ? { provider: skill.source.provider } : {})
          }
        })
  };
}

export function createDefaultManifest(): SkillsManifest {
  return {
    skills: []
  };
}
