import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import type { IndexSkillEntry, IndexVersionEntry, SkillsIndex } from "./types";
import { assertConfiguredPathWithinRoot, readDocument, resolveFileUrlOrPath } from "./utils";

export interface ResolvedIndexVersion {
  version: string;
  entry: IndexVersionEntry;
}

export async function loadIndex(indexPathOrUrl: string, baseDir: string): Promise<{ index: SkillsIndex; indexPath: string }> {
  const indexPath = resolveFileUrlOrPath(baseDir, indexPathOrUrl);
  assertConfiguredPathWithinRoot(baseDir, indexPathOrUrl, indexPath, `source index ${indexPathOrUrl}`);
  const index = await readDocument<unknown>(indexPath) as SkillsIndex;
  validateIndex(index, indexPath);
  return { index, indexPath };
}

function validateIndex(index: SkillsIndex, sourceLabel: string): void {
  if (!index || typeof index !== "object" || !Array.isArray(index.skills)) {
    throw new CliError(`Invalid index at ${sourceLabel}: skills must be an array`, 2);
  }
}

export function findMatchingIndexVersion(
  index: SkillsIndex,
  skillId: string,
  range: string | undefined
): ResolvedIndexVersion {
  const skill = index.skills?.find((entry) => entry.id === skillId);
  if (!skill) {
    throw new CliError(`Skill ${skillId} was not found in the configured index`, 3);
  }

  const availableVersions = Object.keys(skill.versions ?? {}).filter((version) => semver.valid(version));
  const selectedVersion = range ? semver.maxSatisfying(availableVersions, range) : semver.rsort(availableVersions)[0];
  if (!selectedVersion) {
    const detail = range ? ` matching ${range}` : "";
    throw new CliError(`Skill ${skillId} has no index version${detail}`, 3);
  }
  return {
    version: selectedVersion,
    entry: skill.versions[selectedVersion]
  };
}

export function resolveIndexArtifactRoot(indexPath: string, skill: IndexSkillEntry, version: string, entry: IndexVersionEntry): string {
  const artifactUrl = entry.artifact?.url;
  if (!artifactUrl) {
    throw new CliError(`Index entry ${skill.id}@${version} is missing artifact.url`, 3);
  }
  if (entry.artifact?.type !== undefined && entry.artifact.type !== "path") {
    throw new CliError(`Index entry ${skill.id}@${version} uses unsupported artifact type ${entry.artifact.type}`, 3);
  }
  return resolveFileUrlOrPath(path.dirname(indexPath), artifactUrl);
}
