import path from "node:path";
import type { SkillMetadata } from "./types";

export type InspectFieldCategory = "existing" | "generated" | "missing";

export interface InspectFieldRecord {
  category: InspectFieldCategory;
  value?: unknown;
}

export interface InspectReport {
  skill_path: string;
  metadata_path: string;
  generated_at: string;
  skill_md: {
    category: "existing";
    path: string;
  };
  skill_yaml: {
    category: "existing" | "missing";
    path: string;
  };
  fields: Record<string, InspectFieldRecord>;
  preview: SkillMetadata;
  written: boolean;
}

export function buildInspectReport(
  skillRoot: string,
  existingMetadata: SkillMetadata | undefined,
  nextMetadata: SkillMetadata,
  options: { written?: boolean; versionOverridden?: boolean } = {}
): InspectReport {
  const metadataPath = path.join(skillRoot, "skill.yaml");
  const fields: Record<string, InspectFieldRecord> = {
    schema: classifyValue(existingMetadata?.schema, nextMetadata.schema),
    id: classifyValue(existingMetadata?.id, nextMetadata.id),
    name: classifyValue(existingMetadata?.name, nextMetadata.name),
    version: classifyValue(existingMetadata?.version, nextMetadata.version, options.versionOverridden),
    description: classifyValue(existingMetadata?.description, nextMetadata.description),
    package: classifyValue(existingMetadata?.package, nextMetadata.package),
    dependencies: classifyValue(existingMetadata?.dependencies, nextMetadata.dependencies),
    requires: classifyValue(existingMetadata?.requires, nextMetadata.requires),
    compatibility: classifyValue(existingMetadata?.compatibility, nextMetadata.compatibility),
    artifacts: classifyValue(existingMetadata?.artifacts, nextMetadata.artifacts)
  };

  return {
    skill_path: skillRoot,
    metadata_path: metadataPath,
    generated_at: new Date().toISOString(),
    skill_md: {
      category: "existing",
      path: path.join(skillRoot, "SKILL.md")
    },
    skill_yaml: {
      category: existingMetadata ? "existing" : "missing",
      path: metadataPath
    },
    fields,
    preview: nextMetadata,
    written: Boolean(options.written)
  };
}

export function renderInspectText(report: InspectReport): string {
  const existingFields = listFieldNames(report.fields, "existing");
  const generatedFields = listFieldNames(report.fields, "generated");
  const missingFields = listFieldNames(report.fields, "missing");

  const lines = [
    `Inspecting ${report.skill_path}`,
    `- SKILL.md: present`,
    `- skill.yaml: ${report.skill_yaml.category === "existing" ? "present" : "missing"}`,
    `- existing: ${existingFields.length > 0 ? existingFields.join(", ") : "(none)"}`,
    `- generated: ${generatedFields.length > 0 ? generatedFields.join(", ") : "(none)"}`,
    `- missing: ${missingFields.length > 0 ? missingFields.join(", ") : "(none)"}`
  ];

  if (report.written) {
    lines.push(`Wrote ${report.metadata_path}`);
  } else {
    lines.push("Preview:");
  }

  return lines.join("\n");
}

function classifyValue(existingValue: unknown, nextValue: unknown, forceGenerated = false): InspectFieldRecord {
  if (existingValue !== undefined && !forceGenerated) {
    return {
      category: "existing",
      value: nextValue
    };
  }
  if (nextValue !== undefined) {
    return {
      category: "generated",
      value: nextValue
    };
  }
  return {
    category: "missing"
  };
}

function listFieldNames(fields: Record<string, InspectFieldRecord>, category: InspectFieldCategory): string[] {
  return Object.entries(fields)
    .filter(([, field]) => field.category === category)
    .map(([fieldName]) => fieldName);
}
