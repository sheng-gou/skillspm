import path from "node:path";
import semver from "semver";
import type { ScopeLayout } from "./scope";
import type { LibrarySkillSource, SkillsLibrary } from "./types";
import { CliError } from "./errors";
import { buildInstalledEntryName, copyDir, ensureDir, exists, readDocument, writeYamlDocument } from "./utils";

const ALLOWED_LIBRARY_SOURCE_KINDS = new Set<LibrarySkillSource["kind"]>(["local", "target", "provider"]);

export async function loadLibrary(layout: ScopeLayout): Promise<SkillsLibrary> {
  if (!(await exists(layout.libraryFile))) {
    return createEmptyLibrary();
  }

  const value = await readDocument<unknown>(layout.libraryFile);
  return validateLibrary(value);
}

export async function writeLibrary(layout: ScopeLayout, library: SkillsLibrary): Promise<void> {
  await ensureDir(layout.cacheDir);
  await ensureDir(layout.librarySkillsDir);
  await writeYamlDocument(layout.libraryFile, {
    schema: "skills-library/v1",
    skills: Object.fromEntries(
      Object.entries(library.skills)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([skillId, record]) => [
          skillId,
          {
            versions: Object.fromEntries(
              Object.entries(record.versions)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([version, entry]) => [
                  version,
                  {
                    path: entry.path,
                    cached_at: entry.cached_at,
                    ...(entry.source ? { source: entry.source } : {})
                  }
                ])
            )
          }
        ])
    )
  });
}

export async function cacheSkill(
  layout: ScopeLayout,
  library: SkillsLibrary,
  skillId: string,
  version: string,
  sourcePath: string,
  source?: LibrarySkillSource
): Promise<string> {
  await ensureDir(layout.cacheDir);
  await ensureDir(layout.librarySkillsDir);

  const cachePath = path.join(layout.librarySkillsDir, buildInstalledEntryName(skillId, version));
  if (path.resolve(sourcePath) !== path.resolve(cachePath)) {
    await copyDir(sourcePath, cachePath, { dereference: true });
  }

  const currentRecord = library.skills[skillId] ?? { versions: {} };
  const existingEntry = currentRecord.versions[version];
  currentRecord.versions[version] = {
    path: cachePath,
    cached_at: new Date().toISOString(),
    ...((source ?? existingEntry?.source) ? { source: source ?? existingEntry?.source } : {})
  };
  library.skills[skillId] = currentRecord;
  await writeLibrary(layout, library);
  return cachePath;
}

export async function resolveCachedSkillPath(
  layout: ScopeLayout,
  library: SkillsLibrary,
  skillId: string,
  version: string
): Promise<string | undefined> {
  const recordedPath = library.skills[skillId]?.versions[version]?.path;
  if (recordedPath && (await exists(recordedPath))) {
    return recordedPath;
  }

  const fallbackPath = path.join(layout.librarySkillsDir, buildInstalledEntryName(skillId, version));
  if (await exists(fallbackPath)) {
    return fallbackPath;
  }
  return undefined;
}

export function selectCachedVersion(library: SkillsLibrary, skillId: string, requestedRange?: string): string | undefined {
  const versions = Object.keys(library.skills[skillId]?.versions ?? {});
  if (versions.length === 0) {
    return undefined;
  }

  const semverVersions = versions.filter((version) => semver.valid(version) === version);
  if (!requestedRange) {
    if (semverVersions.length > 0) {
      return [...semverVersions].sort(semver.rcompare)[0];
    }
    return versions.includes("unversioned") ? "unversioned" : undefined;
  }

  if (requestedRange === "unversioned") {
    return versions.includes("unversioned") ? "unversioned" : undefined;
  }

  const exactMatch = semver.valid(requestedRange) === requestedRange ? requestedRange : undefined;
  if (exactMatch && versions.includes(exactMatch)) {
    return exactMatch;
  }

  const matched = semver.maxSatisfying(semverVersions, requestedRange);
  return matched ?? undefined;
}

function createEmptyLibrary(): SkillsLibrary {
  return {
    schema: "skills-library/v1",
    skills: {}
  };
}

function validateLibrary(value: unknown): SkillsLibrary {
  const raw = value as Partial<SkillsLibrary>;
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError("library.yaml is invalid:\n- expected a YAML object", 2);
  }
  if (raw.schema !== "skills-library/v1") {
    errors.push("schema must be skills-library/v1");
  }
  if (!raw.skills || typeof raw.skills !== "object" || Array.isArray(raw.skills)) {
    errors.push("skills must be an object");
  }

  for (const [skillId, record] of Object.entries(raw.skills ?? {})) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`skills.${skillId} must be an object`);
      continue;
    }
    if (!record.versions || typeof record.versions !== "object" || Array.isArray(record.versions)) {
      errors.push(`skills.${skillId}.versions must be an object`);
      continue;
    }
    for (const [version, entry] of Object.entries(record.versions)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`skills.${skillId}.versions.${version} must be an object`);
        continue;
      }
      if (typeof entry.path !== "string") {
        errors.push(`skills.${skillId}.versions.${version}.path must be a string`);
      }
      if (typeof entry.cached_at !== "string") {
        errors.push(`skills.${skillId}.versions.${version}.cached_at must be a string`);
      }
      if ("source" in entry && entry.source !== undefined) {
        if (!entry.source || typeof entry.source !== "object" || Array.isArray(entry.source)) {
          errors.push(`skills.${skillId}.versions.${version}.source must be an object with kind and value strings`);
          continue;
        }

        const source = entry.source as { kind?: unknown; value?: unknown };
        if (typeof source.kind !== "string") {
          errors.push(`skills.${skillId}.versions.${version}.source.kind must be a string`);
        } else if (!ALLOWED_LIBRARY_SOURCE_KINDS.has(source.kind as LibrarySkillSource["kind"])) {
          errors.push(`skills.${skillId}.versions.${version}.source.kind must be one of: local, target, provider`);
        }
        if (typeof source.value !== "string") {
          errors.push(`skills.${skillId}.versions.${version}.source.value must be a string`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new CliError(`library.yaml is invalid:\n- ${errors.join("\n- ")}`, 2);
  }

  return raw as SkillsLibrary;
}
