export interface ManifestSkill {
  id: string;
  version?: string;
  path?: string;
}

export interface ManifestTarget {
  type: "openclaw" | "codex" | "claude_code" | "generic";
  enabled?: boolean;
  path?: string;
}

export type TargetType = ManifestTarget["type"];
export type InstallMode = "copy" | "symlink";

export interface SkillsManifest {
  schema: "skills/v2";
  skills: ManifestSkill[];
  targets?: ManifestTarget[];
}

export interface SkillDependency {
  id: string;
  version?: string;
}

export interface SkillMetadata {
  schema?: "skill/v1";
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  package?: {
    type?: "dir";
    entry?: string;
  };
  dependencies?: SkillDependency[];
  requires?: {
    binaries?: string[];
    env?: string[];
  };
  compatibility?: {
    os?: Array<"darwin" | "linux" | "win32">;
  };
  artifacts?: {
    skill_md?: string;
  };
}

export interface SkillsLock {
  schema: "skills-lock/v2";
  skills: Record<string, string>;
}

export interface LibrarySkillVersion {
  path: string;
  cached_at: string;
}

export interface LibrarySkillRecord {
  versions: Record<string, LibrarySkillVersion>;
}

export interface SkillsLibrary {
  schema: "skills-library/v1";
  skills: Record<string, LibrarySkillRecord>;
}

export interface SkillsPackManifest {
  schema: "skills-pack-manifest/v1";
  generated_at: string;
  skills: Record<string, {
    version: string;
    entry: string;
  }>;
}

export interface ResolvedSkillNode {
  id: string;
  version: string;
  dependencies: SkillDependency[];
  installPath: string;
  metadata?: SkillMetadata;
  root: boolean;
}

export interface ResolutionResult {
  manifest: SkillsManifest;
  lockfile?: SkillsLock;
  nodes: Map<string, ResolvedSkillNode>;
  rootSkillIds: string[];
}
