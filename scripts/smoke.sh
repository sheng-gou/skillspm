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

LOCAL_INSTALL_PROJECT="$TMPDIR/local-install-project"
mkdir -p "$LOCAL_INSTALL_PROJECT"
cat > "$LOCAL_INSTALL_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: local/example
    version: 1.2.3
YAML

rm -rf "$HOME/.skillspm/skills/local__example@1.2.3"
(
  cd "$LOCAL_INSTALL_PROJECT"
  "${CLI[@]}" install
)
assert_node "const [library] = docs; const entry = library.skills['local/example'].versions['1.2.3']; return entry.path.endsWith('/local__example@1.2.3') && entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$HOME/.skillspm/library.yaml"
[ -d "$HOME/.skillspm/skills/local__example@1.2.3" ]

CACHE_PRIORITY_PROJECT="$TMPDIR/cache-priority-project"
mkdir -p "$CACHE_PRIORITY_PROJECT/cache-skill"
cat > "$CACHE_PRIORITY_PROJECT/cache-skill/skill.yaml" <<'YAML'
id: local/priority
version: 1.0.0
YAML
cat > "$CACHE_PRIORITY_PROJECT/cache-skill/SKILL.md" <<'EOF_SKILL'
# Cache priority skill
EOF_SKILL
printf 'cache\n' > "$CACHE_PRIORITY_PROJECT/cache-skill/materialization.txt"

(
  cd "$CACHE_PRIORITY_PROJECT"
  "${CLI[@]}" add ./cache-skill
)

PACK_BUILD_ROOT="$TMPDIR/cache-priority-pack"
mkdir -p "$PACK_BUILD_ROOT/skills/local__priority@1.0.0"
cat > "$PACK_BUILD_ROOT/skills.yaml" <<'YAML'
skills:
  - id: local/priority
    version: 1.0.0
YAML
cat > "$PACK_BUILD_ROOT/skills.lock" <<'YAML'
schema: skills-lock/v2
skills:
  local/priority: 1.0.0
YAML
cat > "$PACK_BUILD_ROOT/manifest.yaml" <<'YAML'
schema: skills-pack-manifest/v1
generated_at: "2026-03-16T00:00:00.000Z"
skills:
  local/priority:
    version: 1.0.0
    entry: local__priority@1.0.0
YAML
cat > "$PACK_BUILD_ROOT/skills/local__priority@1.0.0/skill.yaml" <<'YAML'
id: local/priority
version: 1.0.0
YAML
cat > "$PACK_BUILD_ROOT/skills/local__priority@1.0.0/SKILL.md" <<'EOF_SKILL'
# Pack priority skill
EOF_SKILL
printf 'pack\n' > "$PACK_BUILD_ROOT/skills/local__priority@1.0.0/materialization.txt"
tar -czf "$TMPDIR/cache-priority.skillspm.tgz" -C "$PACK_BUILD_ROOT" .

(
  cd "$CACHE_PRIORITY_PROJECT"
  "${CLI[@]}" install "$TMPDIR/cache-priority.skillspm.tgz"
)
grep -Fxq "cache" "$HOME/.skillspm/skills/local__priority@1.0.0/materialization.txt"

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
[ -f "$HOME/.skillspm/library.yaml" ]
assert_node "const [library] = docs; const openclaw = library.skills['adopted/openclaw'].versions['2.0.0']; const codex = library.skills['adopted/codex'].versions['3.1.0']; return openclaw.source.kind === 'target' && openclaw.source.value.endsWith('/adopt-openclaw') && codex.source.kind === 'target' && codex.source.value.endsWith('/adopt-codex');" "$HOME/.skillspm/library.yaml"
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

FAIL_PROJECT="$TMPDIR/fail-project"
mkdir -p "$FAIL_PROJECT"
cat > "$FAIL_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: missing/example
    version: 1.2.3
YAML
cat > "$FAIL_PROJECT/skills.lock" <<'YAML'
schema: skills-lock/v2
skills:
  missing/example: 1.2.3
YAML

(
  cd "$FAIL_PROJECT"
  set +e
  "${CLI[@]}" install > "$TMPDIR/fail-install.out" 2> "$TMPDIR/fail-install.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "cache lookup failed:" "$TMPDIR/fail-install.err"
grep -Fq "source resolution failed:" "$TMPDIR/fail-install.err"
grep -Fq "no reusable source provenance recorded" "$TMPDIR/fail-install.err"

PROVIDER_FAIL_HOME="$TMPDIR/provider-fail-home"
PROVIDER_FAIL_PROJECT="$TMPDIR/provider-fail-project"
PROVIDER_SOURCE_ROOT="$TMPDIR/provider-fail-source"
mkdir -p "$PROVIDER_FAIL_HOME/.skillspm" "$PROVIDER_FAIL_PROJECT" "$PROVIDER_SOURCE_ROOT"
cat > "$PROVIDER_FAIL_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: provider/example
    version: 1.0.0
YAML
cat > "$PROVIDER_FAIL_PROJECT/skills.lock" <<'YAML'
schema: skills-lock/v2
skills:
  provider/example: 1.0.0
YAML
cat > "$PROVIDER_SOURCE_ROOT/skill.yaml" <<'YAML'
id: provider/example
version: 1.0.0
YAML
cat > "$PROVIDER_SOURCE_ROOT/SKILL.md" <<'EOF_SKILL'
# Provider example
EOF_SKILL
cat > "$PROVIDER_FAIL_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  provider/example:
    versions:
      1.0.0:
        path: $PROVIDER_FAIL_HOME/.skillspm/skills/provider__example@1.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: $PROVIDER_SOURCE_ROOT
YAML

(
  cd "$PROVIDER_FAIL_PROJECT"
  set +e
  HOME="$PROVIDER_FAIL_HOME" "${CLI[@]}" install > "$TMPDIR/provider-fail.out" 2> "$TMPDIR/provider-fail.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source cannot be re-resolved in this build" "$TMPDIR/provider-fail.err"
[ ! -d "$PROVIDER_FAIL_HOME/.skillspm/skills/provider__example@1.0.0" ]

UNKNOWN_KIND_HOME="$TMPDIR/unknown-kind-home"
UNKNOWN_KIND_PROJECT="$TMPDIR/unknown-kind-project"
UNKNOWN_KIND_SOURCE_ROOT="$TMPDIR/unknown-kind-source"
mkdir -p "$UNKNOWN_KIND_HOME/.skillspm" "$UNKNOWN_KIND_PROJECT" "$UNKNOWN_KIND_SOURCE_ROOT"
cat > "$UNKNOWN_KIND_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: weird/example
    version: 1.0.0
YAML
cat > "$UNKNOWN_KIND_PROJECT/skills.lock" <<'YAML'
schema: skills-lock/v2
skills:
  weird/example: 1.0.0
YAML
cat > "$UNKNOWN_KIND_SOURCE_ROOT/skill.yaml" <<'YAML'
id: weird/example
version: 1.0.0
YAML
cat > "$UNKNOWN_KIND_SOURCE_ROOT/SKILL.md" <<'EOF_SKILL'
# Unknown kind example
EOF_SKILL
cat > "$UNKNOWN_KIND_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  weird/example:
    versions:
      1.0.0:
        path: $UNKNOWN_KIND_HOME/.skillspm/skills/weird__example@1.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: weird
          value: $UNKNOWN_KIND_SOURCE_ROOT
YAML

(
  cd "$UNKNOWN_KIND_PROJECT"
  set +e
  HOME="$UNKNOWN_KIND_HOME" "${CLI[@]}" install > "$TMPDIR/unknown-kind.out" 2> "$TMPDIR/unknown-kind.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "library.yaml is invalid:" "$TMPDIR/unknown-kind.err"
grep -Fq "source.kind must be one of: local, target, provider" "$TMPDIR/unknown-kind.err"
[ ! -d "$UNKNOWN_KIND_HOME/.skillspm/skills/weird__example@1.0.0" ]

echo "smoke ok"
