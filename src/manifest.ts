import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { ManifestSkill, ManifestSource, ManifestTarget, SkillsManifest } from "./types";
import { MANIFEST_FILE, exists, readDocument, writeYamlDocument } from "./utils";

const SUPPORTED_RANGE_PATTERN = /^(?:\d+\.\d+\.\d+|\^\d+\.\d+\.\d+|~\d+\.\d+\.\d+)$/;

export function isSupportedVersionRange(value: string): boolean {
  return SUPPORTED_RANGE_PATTERN.test(value) && semver.validRange(value) !== null;
}

export function validateManifest(manifest: unknown): SkillsManifest {
  const errors: string[] = [];
  const value = manifest as Partial<SkillsManifest>;

  if (!value || typeof value !== "object") {
    throw new CliError("skills.yaml must be a YAML object", 2);
  }
  if (value.schema !== "skills/v1") {
    errors.push("schema must be skills/v1");
  }
  if (value.project !== undefined && (typeof value.project !== "object" || value.project === null || Array.isArray(value.project))) {
    errors.push("project must be an object");
  } else if (value.project?.name !== undefined && typeof value.project.name !== "string") {
    errors.push("project.name must be a string");
  }
  if (!Array.isArray(value.skills)) {
    errors.push("skills must be an array");
  }
  if (value.sources && !Array.isArray(value.sources)) {
    errors.push("sources must be an array");
  }
  if (value.targets && !Array.isArray(value.targets)) {
    errors.push("targets must be an array");
  }
  if (value.settings && typeof value.settings !== "object") {
    errors.push("settings must be an object");
  } else if (value.settings) {
    if (value.settings.install_mode !== undefined && !["copy", "symlink"].includes(value.settings.install_mode)) {
      errors.push("settings.install_mode must be copy or symlink");
    }
    if (value.settings.auto_sync !== undefined && typeof value.settings.auto_sync !== "boolean") {
      errors.push("settings.auto_sync must be a boolean");
    }
    if (value.settings.strict !== undefined && typeof value.settings.strict !== "boolean") {
      errors.push("settings.strict must be a boolean");
    }
  }

  const sourceNames = new Set<string>();
  for (const source of value.sources ?? []) {
    validateSource(source, errors, sourceNames);
  }

  for (const target of value.targets ?? []) {
    validateTarget(target, errors);
  }

  const rootIds = new Set<string>();
  for (const skill of value.skills ?? []) {
    validateManifestSkill(skill, errors);
    if (typeof skill.id === "string") {
      if (rootIds.has(skill.id)) {
        errors.push(`duplicate root skill id ${skill.id}`);
      }
      rootIds.add(skill.id);
    }
    if (skill.source && !sourceNames.has(skill.source)) {
      errors.push(`skill ${skill.id} references unknown source ${skill.source}`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(`skills.yaml is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return value as SkillsManifest;
}

function validateSource(source: Partial<ManifestSource>, errors: string[], sourceNames: Set<string>): void {
  if (!source || typeof source !== "object") {
    errors.push("sources entries must be objects");
    return;
  }
  if (!source.name || typeof source.name !== "string") {
    errors.push("source.name must be a string");
  } else if (sourceNames.has(source.name)) {
    errors.push(`duplicate source name ${source.name}`);
  } else {
    sourceNames.add(source.name);
  }
  if (source.type !== "index" && source.type !== "git") {
    errors.push(`source ${source.name ?? "<unknown>"} has unsupported type ${String(source.type)}`);
  }
  if (!source.url || typeof source.url !== "string") {
    errors.push(`source ${source.name ?? "<unknown>"} must include url`);
  }
}

function validateManifestSkill(skill: Partial<ManifestSkill>, errors: string[]): void {
  if (!skill || typeof skill !== "object") {
    errors.push("skills entries must be objects");
    return;
  }
  if (!skill.id || typeof skill.id !== "string") {
    errors.push("skill.id must be a string");
  }
  if (skill.path !== undefined && typeof skill.path !== "string") {
    errors.push(`skill ${skill.id ?? "<unknown>"} path must be a string`);
  }
  if (skill.source !== undefined && typeof skill.source !== "string") {
    errors.push(`skill ${skill.id ?? "<unknown>"} source must be a string`);
  }
  if (skill.version !== undefined) {
    if (typeof skill.version !== "string") {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be a string`);
    } else if (!isSupportedVersionRange(skill.version)) {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be exact, caret, or tilde semver`);
    }
  }
}

function validateTarget(target: Partial<ManifestTarget>, errors: string[]): void {
  if (!target || typeof target !== "object") {
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
  const manifestPath = path.join(cwd, MANIFEST_FILE);
  if (!(await exists(manifestPath))) {
    throw new CliError("skills.yaml not found. Run `skillspm init` first.", 2);
  }
  return validateManifest(await readDocument<unknown>(manifestPath));
}

export async function saveManifest(cwd: string, manifest: SkillsManifest): Promise<void> {
  const manifestPath = path.join(cwd, MANIFEST_FILE);
  await writeYamlDocument(manifestPath, manifest);
}

export function createDefaultManifest(projectName: string): SkillsManifest {
  return {
    schema: "skills/v1",
    project: { name: projectName },
    sources: [],
    skills: [],
    settings: {
      install_mode: "copy",
      auto_sync: false,
      strict: false
    }
  };
}
