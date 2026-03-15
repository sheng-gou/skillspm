import path from "node:path";
import semver from "semver";
import { CliError } from "./errors";
import {
  parseCanonicalProviderSkillReference,
  validatePhase1GitSourceUrl
} from "./git-source";
import type {
  ManifestPack,
  ManifestSkill,
  ManifestSource,
  ManifestSourceProvider,
  ManifestTarget,
  SkillsManifest
} from "./types";
import { MANIFEST_FILE, exists, readDocument, writeYamlDocument } from "./utils";

interface GithubRepoIdentity {
  owner: string;
  repo: string;
  canonical: string;
}

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
  if (value.packs && !Array.isArray(value.packs)) {
    errors.push("packs must be an array");
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
  const sourceMap = new Map<string, ManifestSource>();
  for (const source of value.sources ?? []) {
    validateSource(source, errors, sourceNames, sourceMap);
  }

  const packNames = new Set<string>();
  for (const pack of value.packs ?? []) {
    validatePack(pack, errors, packNames);
  }

  for (const target of value.targets ?? []) {
    validateTarget(target, errors);
  }

  const rootIds = new Set<string>();
  for (const skill of value.skills ?? []) {
    validateManifestSkill(skill, errors, sourceMap);
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

function validateSource(
  source: Partial<ManifestSource>,
  errors: string[],
  sourceNames: Set<string>,
  sourceMap: Map<string, ManifestSource>
): void {
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
  } else if (source.type === "git") {
    const sourceUrlError = validatePhase1GitSourceUrl(source.url);
    if (sourceUrlError) {
      errors.push(`source ${source.name ?? "<unknown>"} url is invalid: ${sourceUrlError}`);
    }
  }

  if (source.provider !== undefined) {
    validateSourceProvider(source, errors);
  }

  if (source.type === "index" && source.provider !== undefined) {
    errors.push(`source ${source.name ?? "<unknown>"} provider is only supported for git sources`);
  }

  if (typeof source.name === "string") {
    sourceMap.set(source.name, source as ManifestSource);
  }
}

function validateSourceProvider(source: Partial<ManifestSource>, errors: string[]): void {
  const provider = source.provider as Partial<ManifestSourceProvider> | undefined;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    errors.push(`source ${source.name ?? "<unknown>"} provider must be an object`);
    return;
  }
  if (provider.kind !== "skills.sh" && provider.kind !== "clawhub") {
    errors.push(`source ${source.name ?? "<unknown>"} provider.kind must be skills.sh or clawhub`);
  }
}

function validatePack(pack: Partial<ManifestPack>, errors: string[], packNames: Set<string>): void {
  if (!pack || typeof pack !== "object") {
    errors.push("packs entries must be objects");
    return;
  }
  if (!pack.name || typeof pack.name !== "string") {
    errors.push("pack.name must be a string");
  } else if (packNames.has(pack.name)) {
    errors.push(`duplicate pack name ${pack.name}`);
  } else {
    packNames.add(pack.name);
  }
  if (!pack.path || typeof pack.path !== "string") {
    errors.push(`pack ${pack.name ?? "<unknown>"} must include path`);
  }
}

function validateManifestSkill(
  skill: Partial<ManifestSkill>,
  errors: string[],
  sourceMap: Map<string, ManifestSource>
): void {
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
  if (skill.provider_ref !== undefined && typeof skill.provider_ref !== "string") {
    errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref must be a string`);
  }
  if (skill.version !== undefined) {
    if (typeof skill.version !== "string") {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be a string`);
    } else if (!isSupportedVersionRange(skill.version)) {
      errors.push(`skill ${skill.id ?? "<unknown>"} version must be exact, caret, or tilde semver`);
    }
  }

  if (skill.path !== undefined && skill.source !== undefined) {
    errors.push(`skill ${skill.id ?? "<unknown>"} cannot declare both path and source`);
  }
  if (skill.provider_ref !== undefined) {
    if (skill.path !== undefined) {
      errors.push(`skill ${skill.id ?? "<unknown>"} cannot declare provider_ref together with path`);
    }
    if (!skill.source) {
      errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref requires source`);
    } else {
      const source = sourceMap.get(skill.source);
      if (source && (source.type !== "git" || !source.provider)) {
        errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref requires a git source with provider.kind`);
      }
      const parsedProviderRef = parseCanonicalProviderSkillReference(skill.provider_ref);
      if (typeof parsedProviderRef === "string") {
        errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref is invalid: ${parsedProviderRef}`);
      } else if (!parsedProviderRef) {
        errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref must be a canonical skills.sh/clawhub ref`);
      } else {
        if (source?.provider?.kind && source.provider.kind !== parsedProviderRef.provider) {
          errors.push(
            `skill ${skill.id ?? "<unknown>"} provider_ref provider ${parsedProviderRef.provider} does not match source ${source.name} provider ${source.provider.kind}`
          );
        }
        if (source?.url) {
          const sourceRepo = normalizeGithubRepoIdentity(source.url);
          if (!sourceRepo) {
            errors.push(`skill ${skill.id ?? "<unknown>"} provider_ref requires source ${source.name} url to point at https://github.com/<owner>/<repo>[.git]`);
          } else if (sourceRepo.canonical !== canonicalGithubRepoIdentity(parsedProviderRef.owner, parsedProviderRef.repo)) {
            errors.push(
              `skill ${skill.id ?? "<unknown>"} provider_ref repo ${parsedProviderRef.owner}/${parsedProviderRef.repo} does not match source ${source.name} repo ${sourceRepo.owner}/${sourceRepo.repo}`
            );
          }
        }
      }
    }
  }
}

function normalizeGithubRepoIdentity(url: string): GithubRepoIdentity | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    return undefined;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return undefined;
  }

  const owner = segments[0].trim();
  const repo = segments[1].replace(/\.git$/i, "").trim();
  if (!owner || !repo) {
    return undefined;
  }

  return {
    owner,
    repo,
    canonical: canonicalGithubRepoIdentity(owner, repo)
  };
}

function canonicalGithubRepoIdentity(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
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
    packs: [],
    skills: [],
    settings: {
      install_mode: "copy",
      auto_sync: false,
      strict: false
    }
  };
}
