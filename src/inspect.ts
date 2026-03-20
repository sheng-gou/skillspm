import type { ScopeLayout } from "./scope";
import { formatScopeLabel } from "./scope";
import { describeProjectState, inspectProjectState, type NextSafeAction, type ProjectStateSnapshot } from "./state";
import { printInfo } from "./utils";

export async function runInspect(layout: ScopeLayout, options: { json?: boolean } = {}): Promise<void> {
  const snapshot = await inspectProjectState(layout);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }

  printInfo(renderInspect(snapshot));
}

function renderInspect(snapshot: ProjectStateSnapshot): string {
  const lines = [
    `Project state: ${describeProjectState(snapshot.state)}`,
    snapshot.summary
  ];

  if (snapshot.details.length > 0) {
    lines.push("", "Details:");
    for (const detail of snapshot.details) {
      lines.push(`- ${detail}`);
    }
  }

  if (snapshot.nextActions.length > 0) {
    lines.push("", "Next safe actions:");
    snapshot.nextActions.forEach((action, index) => {
      lines.push(`  ${index + 1}. ${formatAction(action)}`);
    });
  }

  lines.push(
    "",
    "Internal details:",
    `- Scope: ${formatScopeLabel(snapshot.scope)}`,
    `- Root: ${snapshot.rootDir}`,
    `- Intent skills: ${snapshot.manifestSkillCount}`,
    `- Confirmed skills: ${snapshot.lockSkillCount}`,
    `- Alignment: ${snapshot.alignment}`
  );

  return lines.join("\n");
}

function formatAction(action: NextSafeAction): string {
  return action.command ? `${action.command} — ${action.description}` : action.description;
}
