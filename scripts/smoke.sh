#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
CLI=(node "$ROOT_DIR/dist/bin/skillspm.js")

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
export HOME="$TMPDIR/home"
mkdir -p "$HOME"

assert_file_contains() {
  local file=$1
  local needle=$2
  grep -Fq -- "$needle" "$file"
}

assert_node() {
  local script=$1
  shift
  ASSERT_SCRIPT="$script" node --input-type=module - "$@" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';
const args = process.argv.slice(2);
const docs = args.map((file) => {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    return JSON.parse(raw);
  }
  return YAML.parse(raw);
});
const fn = new Function('docs', process.env.ASSERT_SCRIPT ?? 'return false;');
const result = fn(docs);
if (result === false) {
  process.exit(1);
}
NODE
}

# Help surface
"${CLI[@]}" help add > "$TMPDIR/help-add.txt"
"${CLI[@]}" help adopt > "$TMPDIR/help-adopt.txt"
"${CLI[@]}" help sync > "$TMPDIR/help-sync.txt"
"${CLI[@]}" help doctor > "$TMPDIR/help-doctor.txt"
assert_file_contains "$TMPDIR/help-add.txt" "skillspm add <content>"
assert_file_contains "$TMPDIR/help-add.txt" "--provider <provider>"
assert_file_contains "$TMPDIR/help-add.txt" "Choose the provider"
assert_file_contains "$TMPDIR/help-adopt.txt" "skillspm adopt openclaw"
assert_file_contains "$TMPDIR/help-sync.txt" "skillspm sync openclaw,codex"
assert_file_contains "$TMPDIR/help-doctor.txt" "project/global conflicts"

# Unified add: local, explicit provider choice, GitHub URL, provider-backed
ADD_PROJECT="$TMPDIR/add-project"
mkdir -p "$ADD_PROJECT/local-skill"
cat > "$ADD_PROJECT/local-skill/skill.yaml" <<'YAML'
id: local/example
version: 1.2.3
YAML
cat > "$ADD_PROJECT/local-skill/SKILL.md" <<'EOF_SKILL'
# Local example
EOF_SKILL

(
  cd "$ADD_PROJECT"
  set +e
  "${CLI[@]}" add owner/repo/skills/demo@^2.0.0 > "$TMPDIR/add-ambiguous.out" 2> "$TMPDIR/add-ambiguous.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Ambiguous add input" "$TMPDIR/add-ambiguous.err"
  grep -Fq -- "--provider <provider>" "$TMPDIR/add-ambiguous.err"

  "${CLI[@]}" add ./local-skill
  "${CLI[@]}" add owner/repo/skills/demo@^2.0.0 --provider github
  "${CLI[@]}" add https://github.com/example/tools/tree/main/skills/url-demo
  "${CLI[@]}" add example/skill@^1.0.0 --provider openclaw
)

assert_node "const [manifest] = docs; if (!manifest || Array.isArray(manifest)) return false; const keys = Object.keys(manifest).sort(); if (keys.join(',') !== 'skills') return false; if (manifest.skills.some((entry) => 'path' in entry || 'source' in entry)) return false; const ids = manifest.skills.map((entry) => entry.id + '@' + (entry.version ?? '')); return ids.includes('local/example@1.2.3') && ids.includes('github:owner/repo/skills/demo@^2.0.0') && ids.includes('github:example/tools/skills/url-demo@') && ids.includes('openclaw:example/skill@^1.0.0');" "$ADD_PROJECT/skills.yaml"
assert_node "const [library] = docs; const entry = library.skills['local/example'].versions['1.2.3']; return entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$HOME/.skillspm/library.yaml"

# Adopt positional sources + multi-target sync + doctor scope/conflict reporting
mkdir -p "$HOME/.openclaw/skills/adopt-openclaw" "$HOME/.codex/skills/adopt-codex"
cat > "$HOME/.openclaw/skills/adopt-openclaw/skill.yaml" <<'YAML'
id: adopted/openclaw
version: 2.0.0
YAML
cat > "$HOME/.openclaw/skills/adopt-openclaw/SKILL.md" <<'EOF_SKILL'
# Adopted openclaw skill
EOF_SKILL
cat > "$HOME/.codex/skills/adopt-codex/skill.yaml" <<'YAML'
id: adopted/codex
version: 3.1.0
YAML
cat > "$HOME/.codex/skills/adopt-codex/SKILL.md" <<'EOF_SKILL'
# Adopted codex skill
EOF_SKILL

ADOPT_PROJECT="$TMPDIR/adopt-project"
mkdir -p "$ADOPT_PROJECT"
(
  cd "$ADOPT_PROJECT"
  "${CLI[@]}" adopt openclaw,codex
  "${CLI[@]}" install
  "${CLI[@]}" sync openclaw,codex
)

assert_node "const [manifest] = docs; const keys = Object.keys(manifest).sort().join(','); if (keys !== 'skills') return false; if (manifest.skills.some((entry) => 'path' in entry)) return false; const ids = manifest.skills.map((entry) => entry.id + '@' + entry.version); return ids.includes('adopted/codex@3.1.0') && ids.includes('adopted/openclaw@2.0.0');" "$ADOPT_PROJECT/skills.yaml"
[ -d "$HOME/.openclaw/skills/adopted__openclaw@2.0.0" ]
[ -d "$HOME/.codex/skills/adopted__codex@3.1.0" ]

mkdir -p "$HOME/.skillspm/global"
cat > "$HOME/.skillspm/global/skills.yaml" <<'YAML'
skills:
  - id: adopted/openclaw
    version: 9.9.9
YAML

(
  cd "$ADOPT_PROJECT"
  "${CLI[@]}" doctor --json > "$TMPDIR/doctor.json"
)

assert_node "const [report] = docs; const messages = report.findings.map((finding) => finding.message); return messages.some((message) => message.includes('manifest contract validated')) && messages.some((message) => message.includes('pack readiness confirmed')) && messages.some((message) => message.includes('manifests differ'));" "$TMPDIR/doctor.json"

echo "smoke ok"
