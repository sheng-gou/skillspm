export type ManifestSourceType = "index" | "git";

export interface ManifestSource {
  name: string;
  type: ManifestSourceType;
  url: string;
}

export interface ManifestPack {
  name: string;
  path: string;
}

export interface ManifestSkill {
  id: string;
  version?: string;
  source?: string;
  path?: string;
}

export interface ManifestTarget {
  type: "openclaw" | "codex" | "claude_code" | "generic";
  enabled?: boolean;
  path?: string;
}

export type TargetType = ManifestTarget["type"];
export type InstallMode = "copy" | "symlink";

export interface ManifestSettings {
  install_mode?: InstallMode;
  auto_sync?: boolean;
  strict?: boolean;
}

export interface SkillsManifest {
  schema: "skills/v1";
  project?: {
    name?: string;
  };
  sources?: ManifestSource[];
  packs?: ManifestPack[];
  skills: ManifestSkill[];
  targets?: ManifestTarget[];
  settings?: ManifestSettings;
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

export interface IndexVersionEntry {
  artifact?: {
    type?: "path";
    url?: string;
  };
  metadata?: {
    path?: string;
  };
}

export interface IndexSkillEntry {
  id: string;
  versions: Record<string, IndexVersionEntry>;
}

export interface SkillsIndex {
  schema?: "skills-index/v1";
  skills?: IndexSkillEntry[];
}

export interface LockResolvedNode {
  version: string;
  source?: {
    type: "index" | "git" | "path";
    name?: string;
    url?: string;
    revision?: string;
  };
  artifact?: {
    type: "path";
    url?: string;
  };
  materialization?: {
    type: "live" | "pack";
    path?: string;
    pack?: string;
    entry?: string;
  };
  dependencies?: string[];
}

export interface LockTargetState {
  type: TargetType;
  path: string;
  configured_path?: string;
  enabled: boolean;
  mode: InstallMode;
  status: "synced";
  last_synced_at: string;
  entry_count?: number;
}

export interface SkillsLock {
  schema: "skills-lock/v1";
  project?: {
    name?: string;
  };
  resolved: Record<string, LockResolvedNode>;
  targets?: Record<string, LockTargetState>;
  generated_at: string;
}

export interface ResolvedSkillNode {
  id: string;
  version: string;
  dependencies: SkillDependency[];
  installPath: string;
  metadata?: SkillMetadata;
  source?: LockResolvedNode["source"];
  artifact?: LockResolvedNode["artifact"];
  materialization?: LockResolvedNode["materialization"];
  root: boolean;
}

export interface ResolutionResult {
  manifest: SkillsManifest;
  nodes: Map<string, ResolvedSkillNode>;
  rootSkillIds: string[];
}

export interface SkillsPack {
  schema: "skills-pack/v1";
  generated_at: string;
  resolved: Record<string, LockResolvedNode>;
}
