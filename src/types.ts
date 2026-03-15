export interface ProjectMetadata {
  name?: string;
}

export type ProviderKind = "skills.sh" | "clawhub";

export interface ManifestSourceProvider {
  kind: ProviderKind;
}

export interface ManifestSkill {
  id: string;
  version?: string;
  source?: string;
  path?: string;
  provider_ref?: string;
}

export interface ManifestSource {
  name: string;
  type: "index" | "git";
  url: string;
  provider?: ManifestSourceProvider;
}

export interface ManifestPack {
  name: string;
  path: string;
}

export interface ManifestTarget {
  type: "openclaw" | "codex" | "claude_code" | "generic";
  path?: string;
  enabled?: boolean;
}

export interface SkillsManifest {
  schema: "skills/v1";
  project?: ProjectMetadata;
  sources?: ManifestSource[];
  packs?: ManifestPack[];
  skills: ManifestSkill[];
  targets?: ManifestTarget[];
  settings?: {
    install_mode?: "copy" | "symlink";
    auto_sync?: boolean;
    strict?: boolean;
  };
}

export interface SkillDependency {
  id: string;
  version?: string;
}

export interface SkillMetadata {
  id: string;
  version?: string;
  dependencies?: SkillDependency[];
}

export interface IndexSkillVersion {
  artifact: {
    path?: string;
    url?: string;
  };
  metadata?: {
    path?: string;
  };
}

export interface IndexSkillEntry {
  id: string;
  versions: Record<string, IndexSkillVersion>;
}

export interface SkillsIndex {
  schema: "skills-index/v1";
  skills: IndexSkillEntry[];
}

export interface ResolvedSkillNode {
  id: string;
  version: string;
  dependencies: SkillDependency[];
  installPath: string;
  metadata?: SkillMetadata;
  source?:
    | {
        type: "index";
        name: string;
        url: string;
      }
    | {
        type: "git";
        name: string;
        url: string;
        revision?: string;
        provider?: ManifestSourceProvider;
      }
    | {
        type: "path";
        url: string;
      };
  artifact?: {
    type: "path";
    url: string;
  };
  materialization?:
    | {
        type: "live";
        path: string;
      }
    | {
        type: "pack";
        pack: string;
        path: string;
        entry: string;
      };
  root?: boolean;
}

export interface ResolutionResult {
  manifest: SkillsManifest;
  nodes: Map<string, ResolvedSkillNode>;
  rootSkillIds: string[];
}

export interface LockTargetState {
  type: ManifestTarget["type"];
  path: string;
  configured_path?: string;
  enabled: boolean;
  mode: "copy" | "symlink";
  status: "synced";
  last_synced_at: string;
  entry_count?: number;
}

export interface LockResolvedNode {
  version: string;
  source?: ResolvedSkillNode["source"];
  artifact?: ResolvedSkillNode["artifact"];
  materialization?: ResolvedSkillNode["materialization"];
  dependencies?: string[];
}

export interface SkillsLock {
  schema: "skills-lock/v1";
  project?: ProjectMetadata;
  resolved: Record<string, LockResolvedNode>;
  targets?: Record<string, LockTargetState>;
  generated_at: string;
}

export interface SkillsPack {
  schema: "skills-pack/v1";
  generated_at: string;
  resolved: Record<
    string,
    {
      version: string;
      source?: ResolvedSkillNode["source"];
      dependencies?: string[];
    }
  >;
}
