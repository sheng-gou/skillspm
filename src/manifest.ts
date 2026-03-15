import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { ManifestSkill, ManifestTarget, SkillsManifest } from "./types";
import { MANIFEST_FILE, ensureDir, exists, readDocument, writeYamlDocument } from "./utils";

const SUPPORTED_RANGE_PATTERN = /^(?:\d+\.\d+\.\d+|\^\d+\.\d+\.\d+|~\d+\.\d+\.\d+|unversioned)$/;
const ALLOWED_MANIFEST_KEYS = new Set(["schema", "skills", "targets"]);

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
  if (value.schema !== "skills/v2") {
    errors.push("schema must be skills/v2");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      errors.push(`unknown top-level key ${key}; allowed keys: schema, skills, targets`);
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
  if (!skill.id || typeof skill.id !== "string") {
    errors.push("skill.id must be a string");
  }
  if (skill.path !== undefined && typeof skill.path !== "string") {
    errors.push(`skill ${skill.id ?? "<unknown>"} path must be a string`);
  }
  if (skill.version !== undefined) {
    if (typeof skill.version !== "string") {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be a string`);
    } else if (!isSupportedVersionRange(skill.version)) {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be exact, caret, tilde, or unversioned`);
    }
  }
}

function validateTarget(target: Partial<ManifestTarget>, errors: string[]): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    errors.push("targets entries must be objects");
    return;
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
  await writeYamlDocument(manifestPath, manifest);
}

export function createDefaultManifest(): SkillsManifest {
  return {
    schema: "skills/v2",
    skills: []
  };
}
