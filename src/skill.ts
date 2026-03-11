import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { SkillMetadata } from "./types";
import { assertPathWithinRoot, exists, readDocument } from "./utils";

export async function loadSkillMetadata(skillRoot: string): Promise<SkillMetadata | undefined> {
  const metadataPath = path.join(skillRoot, "skill.yaml");
  if (!(await exists(metadataPath))) {
    return undefined;
  }

  const metadata = await readDocument<unknown>(metadataPath);
  return validateSkillMetadata(metadata, metadataPath);
}

export function validateSkillMetadata(raw: unknown, sourceLabel: string): SkillMetadata {
  const value = raw as Partial<SkillMetadata>;
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    throw new CliError(`Invalid skill metadata in ${sourceLabel}: expected YAML object`, 2);
  }
  if (value.schema !== undefined && value.schema !== "skill/v1") {
    errors.push("schema must be skill/v1 when present");
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    errors.push("id must be a string");
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    errors.push("name must be a string");
  }
  if (value.version !== undefined && (!semver.valid(value.version) || value.version !== semver.clean(value.version))) {
    errors.push("version must be an exact semver");
  }
  if (value.package !== undefined) {
    if (typeof value.package !== "object") {
      errors.push("package must be an object");
    } else {
      if (value.package.type !== undefined && value.package.type !== "dir") {
        errors.push("package.type must be dir");
      }
      if (value.package.entry !== undefined && typeof value.package.entry !== "string") {
        errors.push("package.entry must be a string");
      }
    }
  }
  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) {
      errors.push("dependencies must be an array");
    } else {
      for (const dependency of value.dependencies) {
        if (!dependency || typeof dependency !== "object") {
          errors.push("dependencies entries must be objects");
          continue;
        }
        if (typeof dependency.id !== "string") {
          errors.push("dependency.id must be a string");
        }
        if (dependency.version !== undefined && typeof dependency.version !== "string") {
          errors.push(`dependency ${dependency.id ?? "<unknown>"} version must be a string`);
        }
      }
    }
  }
  if (value.requires !== undefined) {
    if (typeof value.requires !== "object") {
      errors.push("requires must be an object");
    } else {
      if (value.requires.binaries && !Array.isArray(value.requires.binaries)) {
        errors.push("requires.binaries must be an array");
      }
      if (value.requires.env && !Array.isArray(value.requires.env)) {
        errors.push("requires.env must be an array");
      }
    }
  }
  if (value.compatibility !== undefined) {
    if (typeof value.compatibility !== "object") {
      errors.push("compatibility must be an object");
    } else if (
      value.compatibility.os !== undefined &&
      (!Array.isArray(value.compatibility.os) ||
        value.compatibility.os.some((entry) => !["darwin", "linux", "win32"].includes(entry)))
    ) {
      errors.push("compatibility.os must be an array of darwin, linux, or win32");
    }
  }
  if (value.artifacts !== undefined) {
    if (typeof value.artifacts !== "object") {
      errors.push("artifacts must be an object");
    } else if (value.artifacts.skill_md !== undefined && typeof value.artifacts.skill_md !== "string") {
      errors.push("artifacts.skill_md must be a string");
    }
  }

  if (errors.length > 0) {
    throw new CliError(`Invalid skill metadata in ${sourceLabel}:\n- ${errors.join("\n- ")}`, 2);
  }

  return value as SkillMetadata;
}

export async function resolveSkillMarkdownPath(skillRoot: string, metadata?: SkillMetadata): Promise<string | undefined> {
  const explicit = metadata?.artifacts?.skill_md;
  if (explicit) {
    const explicitPath = path.resolve(skillRoot, explicit);
    assertPathWithinRoot(skillRoot, explicitPath, `artifacts.skill_md for ${skillRoot}`);
    if (await exists(explicitPath)) {
      return explicitPath;
    }
    return undefined;
  }
  const fallback = path.join(skillRoot, "SKILL.md");
  if (await exists(fallback)) {
    return fallback;
  }
  return undefined;
}
