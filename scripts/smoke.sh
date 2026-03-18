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
"${CLI[@]}" help install > "$TMPDIR/help-install.txt"
"${CLI[@]}" help pack > "$TMPDIR/help-pack.txt"
"${CLI[@]}" help freeze > "$TMPDIR/help-freeze.txt"
"${CLI[@]}" help adopt > "$TMPDIR/help-adopt.txt"
"${CLI[@]}" help sync > "$TMPDIR/help-sync.txt"
"${CLI[@]}" help doctor > "$TMPDIR/help-doctor.txt"
assert_file_contains "$TMPDIR/help-add.txt" "skillspm add <content>"
assert_file_contains "$TMPDIR/help-install.txt" "skills.lock"
assert_file_contains "$TMPDIR/help-install.txt" "unauthenticated"
assert_file_contains "$TMPDIR/help-install.txt" "rejects symlinks"
assert_file_contains "$TMPDIR/help-install.txt" "digest mismatch"
assert_file_contains "$TMPDIR/help-pack.txt" "portable supplement"
assert_file_contains "$TMPDIR/help-freeze.txt" "version, digest, and resolution provenance"
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

  set +e
  "${CLI[@]}" add "https://github.com/example/tools/tree/main/skills/url-demo?token=secret" > "$TMPDIR/add-github-query.out" 2> "$TMPDIR/add-github-query.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "anonymous canonical https://github.com/... URLs" "$TMPDIR/add-github-query.err"

  set +e
  "${CLI[@]}" add "https://github.com/owner/repo/../path" > "$TMPDIR/add-github-dot-segment-url.out" 2> "$TMPDIR/add-github-dot-segment-url.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub URL" "$TMPDIR/add-github-dot-segment-url.err"

  set +e
  "${CLI[@]}" add "https://github.com/example/tools//skills/url-demo" > "$TMPDIR/add-github-double-slash-url.out" 2> "$TMPDIR/add-github-double-slash-url.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub URL" "$TMPDIR/add-github-double-slash-url.err"

  set +e
  "${CLI[@]}" add "https://github.com/example/tools/skills%2furl-demo" > "$TMPDIR/add-github-encoded-slash-url.out" 2> "$TMPDIR/add-github-encoded-slash-url.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub URL" "$TMPDIR/add-github-encoded-slash-url.err"

  set +e
  "${CLI[@]}" add "github:example/tools/skills/url-demo?token=secret" > "$TMPDIR/add-github-id-query.out" 2> "$TMPDIR/add-github-id-query.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-query.err"

  set +e
  "${CLI[@]}" add "github:owner/repo/%2e%2e/path" > "$TMPDIR/add-github-id-dot-segment.out" 2> "$TMPDIR/add-github-id-dot-segment.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-dot-segment.err"

  set +e
  "${CLI[@]}" add "github:example/tools/skills/url-demo#fragment" > "$TMPDIR/add-github-id-fragment.out" 2> "$TMPDIR/add-github-id-fragment.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-fragment.err"

  set +e
  "${CLI[@]}" add "github:example//tools/skills/url-demo" > "$TMPDIR/add-github-id-double-slash.out" 2> "$TMPDIR/add-github-id-double-slash.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-double-slash.err"

  set +e
  "${CLI[@]}" add "github:example:secret@tools/skills/url-demo" > "$TMPDIR/add-github-id-credential.out" 2> "$TMPDIR/add-github-id-credential.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-credential.err"

  set +e
  "${CLI[@]}" add "github:example/tools/skills%2Fdemo" > "$TMPDIR/add-github-id-encoded-slash.out" 2> "$TMPDIR/add-github-id-encoded-slash.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-encoded-slash.err"

  set +e
  "${CLI[@]}" add "github:example/tools/skills%5Cdemo" > "$TMPDIR/add-github-id-encoded-backslash.out" 2> "$TMPDIR/add-github-id-encoded-backslash.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Invalid GitHub skill id" "$TMPDIR/add-github-id-encoded-backslash.err"

  set +e
  "${CLI[@]}" add "skillsh:acme/demo-skill" > "$TMPDIR/add-skillsh-alias.out" 2> "$TMPDIR/add-skillsh-alias.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Unsupported provider alias" "$TMPDIR/add-skillsh-alias.err"

  set +e
  "${CLI[@]}" add "acme/demo-skill" --provider skillsh > "$TMPDIR/add-skillsh-provider.out" 2> "$TMPDIR/add-skillsh-provider.err"
  status=$?
  set -e
  test "$status" -ne 0
  grep -Fq "Unsupported provider alias" "$TMPDIR/add-skillsh-provider.err"

  "${CLI[@]}" add ./local-skill
  "${CLI[@]}" add owner/repo/skills/demo@^2.0.0 --provider github
  "${CLI[@]}" add https://github.com/example/tools/tree/main/skills/url-demo
  "${CLI[@]}" add example/skill@^1.0.0 --provider openclaw
)

assert_node "const [manifest] = docs; if (!manifest || Array.isArray(manifest)) return false; const keys = Object.keys(manifest).sort(); if (keys.join(',') !== 'skills') return false; const local = manifest.skills.find((entry) => entry.id === 'local/example'); const github = manifest.skills.find((entry) => entry.id === 'github:owner/repo/skills/demo'); const url = manifest.skills.find((entry) => entry.id === 'github:example/tools/skills/url-demo'); const openclaw = manifest.skills.find((entry) => entry.id === 'openclaw:example/skill'); return Boolean(local && local.version === '1.2.3' && local.source?.kind === 'local' && local.source.value.endsWith('/local-skill') && github && github.version === '^2.0.0' && !('source' in github) && url && !('source' in url) && openclaw && openclaw.version === '^1.0.0' && !('source' in openclaw));" "$ADD_PROJECT/skills.yaml"
assert_node "const [library] = docs; const entry = library.skills['local/example'].versions['1.2.3']; return entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$HOME/.skillspm/library.yaml"

LOCAL_INSTALL_PROJECT="$TMPDIR/local-install-project"
mkdir -p "$LOCAL_INSTALL_PROJECT"
cat > "$LOCAL_INSTALL_PROJECT/skills.yaml" <<YAML
skills:
  - id: local/example
    version: 1.2.3
    source:
      kind: local
      value: $ADD_PROJECT/local-skill
YAML

rm -rf "$HOME/.skillspm"
(
  cd "$LOCAL_INSTALL_PROJECT"
  "${CLI[@]}" install
  "${CLI[@]}" freeze
)
assert_node "const [manifest, library] = docs; const root = manifest.skills[0]; const entry = library.skills['local/example'].versions['1.2.3']; return root.id === 'local/example' && root.version === '1.2.3' && root.source.kind === 'local' && root.source.value.endsWith('/local-skill') && entry.path.endsWith('/local__example@1.2.3') && entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$LOCAL_INSTALL_PROJECT/skills.yaml" "$HOME/.skillspm/library.yaml"
[ -f "$LOCAL_INSTALL_PROJECT/skills.lock" ]
assert_node "const [lockfile] = docs; const entry = lockfile.skills['local/example']; return lockfile.schema === 'skills-lock/v3' && entry.version === '1.2.3' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'local' && entry.resolved_from.ref.endsWith('/local-skill');" "$LOCAL_INSTALL_PROJECT/skills.lock"
[ -d "$HOME/.skillspm/skills/local__example@1.2.3" ]

EXPLICIT_MANIFEST_PATH_HOME="$TMPDIR/explicit-manifest-path-home"
EXPLICIT_MANIFEST_PATH_PROJECT="$TMPDIR/explicit-manifest-path-project"
EXPLICIT_MANIFEST_PATH_RUN_CWD="$TMPDIR/explicit-manifest-path-run-cwd"
mkdir -p "$EXPLICIT_MANIFEST_PATH_HOME" "$EXPLICIT_MANIFEST_PATH_PROJECT/relative-skill" "$EXPLICIT_MANIFEST_PATH_RUN_CWD"
cat > "$EXPLICIT_MANIFEST_PATH_PROJECT/relative-skill/skill.yaml" <<'YAML'
id: local/relative-manifest
version: 9.8.7
YAML
cat > "$EXPLICIT_MANIFEST_PATH_PROJECT/relative-skill/SKILL.md" <<'EOF_SKILL'
# Relative manifest skill
EOF_SKILL
cat > "$EXPLICIT_MANIFEST_PATH_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: local/relative-manifest
    version: 9.8.7
    source:
      kind: local
      value: ./relative-skill
YAML
(
  cd "$EXPLICIT_MANIFEST_PATH_RUN_CWD"
  HOME="$EXPLICIT_MANIFEST_PATH_HOME" "${CLI[@]}" install "$EXPLICIT_MANIFEST_PATH_PROJECT/skills.yaml"
)
assert_node "const [manifest, lockfile] = docs; const root = manifest.skills[0]; const entry = lockfile.skills['local/relative-manifest']; return root.source.kind === 'local' && root.source.value === './relative-skill' && entry.version === '9.8.7' && entry.resolved_from.type === 'local' && entry.resolved_from.ref === '$EXPLICIT_MANIFEST_PATH_PROJECT/relative-skill';" "$EXPLICIT_MANIFEST_PATH_PROJECT/skills.yaml" "$EXPLICIT_MANIFEST_PATH_PROJECT/skills.lock"

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

PACK_PROVENANCE_SOURCE="$TMPDIR/pack-provenance-source"
mkdir -p "$PACK_PROVENANCE_SOURCE/local-skill"
cat > "$PACK_PROVENANCE_SOURCE/local-skill/skill.yaml" <<'YAML'
id: local/pack-source
version: 4.0.0
YAML
cat > "$PACK_PROVENANCE_SOURCE/local-skill/SKILL.md" <<'EOF_SKILL'
# Pack provenance source
EOF_SKILL
(
  cd "$PACK_PROVENANCE_SOURCE"
  "${CLI[@]}" add ./local-skill
  "${CLI[@]}" install
  "${CLI[@]}" pack "$TMPDIR/pack-provenance.skillspm.tgz"
)
PACK_PROVENANCE_HOME="$TMPDIR/pack-provenance-home"
PACK_PROVENANCE_INSTALL_CWD="$TMPDIR/pack-provenance-install-cwd"
PACK_PROVENANCE_PROJECT="$TMPDIR/pack-provenance-project"
mkdir -p "$PACK_PROVENANCE_HOME" "$PACK_PROVENANCE_INSTALL_CWD" "$PACK_PROVENANCE_PROJECT"
(
  cd "$PACK_PROVENANCE_INSTALL_CWD"
  HOME="$PACK_PROVENANCE_HOME" "${CLI[@]}" install "$TMPDIR/pack-provenance.skillspm.tgz"
)
assert_node "const [library] = docs; const entry = library.skills['local/pack-source'].versions['4.0.0']; return entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$PACK_PROVENANCE_HOME/.skillspm/library.yaml"
tar -xzf "$TMPDIR/pack-provenance.skillspm.tgz" -C "$PACK_PROVENANCE_PROJECT"
assert_node "const [manifest] = docs; const root = manifest.skills[0]; return manifest.skills.length === 1 && root.id === 'local/pack-source' && root.version === '4.0.0' && root.source.kind === 'local' && root.source.value.endsWith('/local-skill');" "$PACK_PROVENANCE_PROJECT/skills.yaml"
(
  cd "$PACK_PROVENANCE_PROJECT"
  HOME="$PACK_PROVENANCE_HOME" "${CLI[@]}" freeze
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['local/pack-source']; return lockfile.schema === 'skills-lock/v3' && entry.version === '4.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'local' && entry.resolved_from.ref.endsWith('/local-skill');" "$PACK_PROVENANCE_PROJECT/skills.lock"
rm -rf "$PACK_PROVENANCE_HOME/.skillspm/skills/local__pack-source@4.0.0"
(
  cd "$PACK_PROVENANCE_PROJECT"
  HOME="$PACK_PROVENANCE_HOME" "${CLI[@]}" install
)
[ -d "$PACK_PROVENANCE_HOME/.skillspm/skills/local__pack-source@4.0.0" ]

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
  "${CLI[@]}" freeze
  "${CLI[@]}" sync openclaw,codex
)

assert_node "const [manifest] = docs; const keys = Object.keys(manifest).sort().join(','); if (keys !== 'skills') return false; if (manifest.skills.some((entry) => 'path' in entry)) return false; const openclaw = manifest.skills.find((entry) => entry.id === 'adopted/openclaw'); const codex = manifest.skills.find((entry) => entry.id === 'adopted/codex'); return openclaw?.version === '2.0.0' && openclaw?.source?.kind === 'target' && openclaw.source.value.endsWith('/adopt-openclaw') && codex?.version === '3.1.0' && codex?.source?.kind === 'target' && codex.source.value.endsWith('/adopt-codex');" "$ADOPT_PROJECT/skills.yaml"
[ -f "$ADOPT_PROJECT/skills.lock" ]
assert_node "const [lockfile] = docs; const openclaw = lockfile.skills['adopted/openclaw']; const codex = lockfile.skills['adopted/codex']; return lockfile.schema === 'skills-lock/v3' && openclaw.version === '2.0.0' && codex.version === '3.1.0' && /^sha256:[0-9a-f]{64}$/.test(openclaw.digest) && /^sha256:[0-9a-f]{64}$/.test(codex.digest) && openclaw.resolved_from.type === 'target' && codex.resolved_from.type === 'target';" "$ADOPT_PROJECT/skills.lock"
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

STALE_LOCK_INSTALL_PROJECT="$TMPDIR/stale-lock-install-project"
mkdir -p "$STALE_LOCK_INSTALL_PROJECT/skill-v1" "$STALE_LOCK_INSTALL_PROJECT/skill-v2"
cat > "$STALE_LOCK_INSTALL_PROJECT/skill-v1/skill.yaml" <<'YAML'
id: stale/install
version: 1.0.0
YAML
cat > "$STALE_LOCK_INSTALL_PROJECT/skill-v1/SKILL.md" <<'EOF_SKILL'
# Stale install v1
EOF_SKILL
printf 'v1\n' > "$STALE_LOCK_INSTALL_PROJECT/skill-v1/materialization.txt"
cat > "$STALE_LOCK_INSTALL_PROJECT/skill-v2/skill.yaml" <<'YAML'
id: stale/install
version: 2.0.0
YAML
cat > "$STALE_LOCK_INSTALL_PROJECT/skill-v2/SKILL.md" <<'EOF_SKILL'
# Stale install v2
EOF_SKILL
printf 'v2\n' > "$STALE_LOCK_INSTALL_PROJECT/skill-v2/materialization.txt"

(
  cd "$STALE_LOCK_INSTALL_PROJECT"
  "${CLI[@]}" add ./skill-v1
  "${CLI[@]}" install
  "${CLI[@]}" add ./skill-v2
  "${CLI[@]}" install
)

assert_node "const [manifest, lockfile] = docs; const entry = lockfile.skills['stale/install']; return manifest.skills.length === 1 && manifest.skills[0].id === 'stale/install' && manifest.skills[0].version === '2.0.0' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'local' && entry.resolved_from.ref.endsWith('/skill-v2');" "$STALE_LOCK_INSTALL_PROJECT/skills.yaml" "$STALE_LOCK_INSTALL_PROJECT/skills.lock"
grep -Fxq "v2" "$HOME/.skillspm/skills/stale__install@2.0.0/materialization.txt"

STALE_LOCK_FREEZE_PROJECT="$TMPDIR/stale-lock-freeze-project"
mkdir -p "$STALE_LOCK_FREEZE_PROJECT/skill-v1" "$STALE_LOCK_FREEZE_PROJECT/skill-v2"
cat > "$STALE_LOCK_FREEZE_PROJECT/skill-v1/skill.yaml" <<'YAML'
id: stale/freeze
version: 1.0.0
YAML
cat > "$STALE_LOCK_FREEZE_PROJECT/skill-v1/SKILL.md" <<'EOF_SKILL'
# Stale freeze v1
EOF_SKILL
printf 'v1\n' > "$STALE_LOCK_FREEZE_PROJECT/skill-v1/materialization.txt"
cat > "$STALE_LOCK_FREEZE_PROJECT/skill-v2/skill.yaml" <<'YAML'
id: stale/freeze
version: 2.0.0
YAML
cat > "$STALE_LOCK_FREEZE_PROJECT/skill-v2/SKILL.md" <<'EOF_SKILL'
# Stale freeze v2
EOF_SKILL
printf 'v2\n' > "$STALE_LOCK_FREEZE_PROJECT/skill-v2/materialization.txt"

(
  cd "$STALE_LOCK_FREEZE_PROJECT"
  "${CLI[@]}" add ./skill-v1
  "${CLI[@]}" install
  "${CLI[@]}" add ./skill-v2
  "${CLI[@]}" freeze
)

assert_node "const [manifest, lockfile] = docs; const entry = lockfile.skills['stale/freeze']; return manifest.skills.length === 1 && manifest.skills[0].id === 'stale/freeze' && manifest.skills[0].version === '2.0.0' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'local' && entry.resolved_from.ref.endsWith('/skill-v2');" "$STALE_LOCK_FREEZE_PROJECT/skills.yaml" "$STALE_LOCK_FREEZE_PROJECT/skills.lock"

DIGEST_FAIL_PROJECT="$TMPDIR/digest-fail-project"
mkdir -p "$DIGEST_FAIL_PROJECT/digest-skill"
cat > "$DIGEST_FAIL_PROJECT/digest-skill/skill.yaml" <<'YAML'
id: digest/example
version: 4.5.6
YAML
cat > "$DIGEST_FAIL_PROJECT/digest-skill/SKILL.md" <<'EOF_SKILL'
# Digest example
EOF_SKILL
printf 'original\n' > "$DIGEST_FAIL_PROJECT/digest-skill/materialization.txt"

(
  cd "$DIGEST_FAIL_PROJECT"
  "${CLI[@]}" add ./digest-skill
  "${CLI[@]}" install
)

printf 'tampered\n' > "$HOME/.skillspm/skills/digest__example@4.5.6/materialization.txt"

(
  cd "$DIGEST_FAIL_PROJECT"
  set +e
  "${CLI[@]}" install > "$TMPDIR/digest-fail.out" 2> "$TMPDIR/digest-fail.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "failed closed: digest mismatch" "$TMPDIR/digest-fail.err"
grep -Fq "digest/example@4.5.6" "$TMPDIR/digest-fail.err"

PROVIDER_BOOTSTRAP_HOME="$TMPDIR/provider-bootstrap-home"
PROVIDER_BOOTSTRAP_CLEAN_HOME="$TMPDIR/provider-bootstrap-clean-home"
PROVIDER_DIRECT_SKILLS_SH_HOME="$TMPDIR/provider-direct-skills-sh-home"
PROVIDER_DIRECT_OPENCLAW_HOME="$TMPDIR/provider-direct-openclaw-home"
PROVIDER_RECORDED_SKILLS_SH_HOME="$TMPDIR/provider-recorded-skills-sh-home"
PROVIDER_RECORDED_OPENCLAW_HOME="$TMPDIR/provider-recorded-openclaw-home"
PROVIDER_RECORDED_CLAWHUB_HOME="$TMPDIR/provider-recorded-clawhub-home"
PROVIDER_SKILLS_SH_PROJECT="$TMPDIR/provider-skills-sh-project"
PROVIDER_OPENCLAW_PROJECT="$TMPDIR/provider-openclaw-project"
PROVIDER_CLAWHUB_PROJECT="$TMPDIR/provider-clawhub-project"
PROVIDER_DIRECT_SKILLS_SH_PROJECT="$TMPDIR/provider-direct-skills-sh-project"
PROVIDER_DIRECT_OPENCLAW_PROJECT="$TMPDIR/provider-direct-openclaw-project"
PROVIDER_RECORDED_SKILLS_SH_PROJECT="$TMPDIR/provider-recorded-skills-sh-project"
PROVIDER_RECORDED_OPENCLAW_PROJECT="$TMPDIR/provider-recorded-openclaw-project"
PROVIDER_RECORDED_CLAWHUB_PROJECT="$TMPDIR/provider-recorded-clawhub-project"
PROVIDER_BOOTSTRAP_FAIL_PROJECT="$TMPDIR/provider-bootstrap-fail-project"
PROVIDER_SKILLS_SH_FIXTURE_ROOT="$TMPDIR/provider-skills-sh-fixtures"
PROVIDER_OPENCLAW_FIXTURE_ROOT="$TMPDIR/provider-openclaw-fixtures"
PROVIDER_CLAWHUB_FIXTURE_ROOT="$TMPDIR/provider-clawhub-fixtures"
mkdir -p "$PROVIDER_BOOTSTRAP_HOME" "$PROVIDER_BOOTSTRAP_CLEAN_HOME" "$PROVIDER_DIRECT_SKILLS_SH_HOME" "$PROVIDER_DIRECT_OPENCLAW_HOME" "$PROVIDER_RECORDED_SKILLS_SH_HOME" "$PROVIDER_RECORDED_OPENCLAW_HOME" "$PROVIDER_RECORDED_CLAWHUB_HOME" "$PROVIDER_SKILLS_SH_PROJECT" "$PROVIDER_OPENCLAW_PROJECT" "$PROVIDER_CLAWHUB_PROJECT" "$PROVIDER_DIRECT_SKILLS_SH_PROJECT" "$PROVIDER_DIRECT_OPENCLAW_PROJECT" "$PROVIDER_RECORDED_SKILLS_SH_PROJECT" "$PROVIDER_RECORDED_OPENCLAW_PROJECT" "$PROVIDER_RECORDED_CLAWHUB_PROJECT" "$PROVIDER_BOOTSTRAP_FAIL_PROJECT" "$PROVIDER_SKILLS_SH_FIXTURE_ROOT/acme" "$PROVIDER_OPENCLAW_FIXTURE_ROOT/api/v1/skills/example" "$PROVIDER_CLAWHUB_FIXTURE_ROOT/api/v1/skills/example"

cat > "$PROVIDER_SKILLS_SH_FIXTURE_ROOT/acme/demo-skill.html" <<'EOF_SKILLS_SH'
<html><body><code>npx skills add https://github.com/example/skills-sh-skill --skill skills/demo-skill</code></body></html>
EOF_SKILLS_SH
cat > "$PROVIDER_SKILLS_SH_FIXTURE_ROOT/acme/no-github.html" <<'EOF_SKILLS_SH_FAIL'
<html><body><p>No public github source here.</p></body></html>
EOF_SKILLS_SH_FAIL
cat > "$PROVIDER_OPENCLAW_FIXTURE_ROOT/api/v1/skills/example/provider-demo.json" <<'EOF_OPENCLAW'
{"github_url":"https://github.com/example/openclaw-skill/tree/main/skills/provider-demo"}
EOF_OPENCLAW
cat > "$PROVIDER_OPENCLAW_FIXTURE_ROOT/api/v1/skills/example/no-github.json" <<'EOF_OPENCLAW_FAIL'
{"download_url":"https://registry.example.invalid/archive.zip"}
EOF_OPENCLAW_FAIL
cat > "$PROVIDER_CLAWHUB_FIXTURE_ROOT/api/v1/skills/example/provider-demo.json" <<'EOF_CLAWHUB'
{"install_command":"skillspm add https://github.com/example/clawhub-skill/tree/main/skills/provider-demo"}
EOF_CLAWHUB

PROVIDER_SKILLS_SH_BASE_URL="$PROVIDER_SKILLS_SH_FIXTURE_ROOT"
PROVIDER_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_FIXTURE_ROOT"
PROVIDER_CLAWHUB_BASE_URL="$PROVIDER_CLAWHUB_FIXTURE_ROOT"

PROVIDER_FAIL_HOME="$TMPDIR/provider-fail-home"
PROVIDER_CLEAN_HOME="$TMPDIR/provider-clean-home"
PROVIDER_CLEAN_PROJECT="$TMPDIR/provider-clean-project"
PROVIDER_FIXTURE_ROOT="$TMPDIR/provider-github"
PROVIDER_WORKTREE="$TMPDIR/provider-worktree"
PROVIDER_REFRESH_PROJECT="$TMPDIR/provider-refresh-project"
PROVIDER_CRED_URL_HOME="$TMPDIR/provider-credential-url-home"
PROVIDER_CRED_URL_PROJECT="$TMPDIR/provider-credential-url-project"
PROVIDER_URL_HOME="$TMPDIR/provider-url-home"
PROVIDER_URL_PROJECT="$TMPDIR/provider-url-project"
PROVIDER_LOCK_HOME="$TMPDIR/provider-lock-home"
PROVIDER_LOCK_PROJECT="$TMPDIR/provider-lock-project"
PROVIDER_LOCK_PRIORITY_HOME="$TMPDIR/provider-lock-priority-home"
PROVIDER_LOCK_PRIORITY_PROJECT="$TMPDIR/provider-lock-priority-project"
PROVIDER_LOCK_CRED_HOME="$TMPDIR/provider-lock-credential-home"
PROVIDER_LOCK_CRED_PROJECT="$TMPDIR/provider-lock-credential-project"
PROVIDER_QUERY_HOME="$TMPDIR/provider-query-home"
PROVIDER_QUERY_PROJECT="$TMPDIR/provider-query-project"
PROVIDER_LOCK_QUERY_HOME="$TMPDIR/provider-lock-query-home"
PROVIDER_LOCK_QUERY_PROJECT="$TMPDIR/provider-lock-query-project"
PROVIDER_FRAGMENT_HOME="$TMPDIR/provider-fragment-home"
PROVIDER_FRAGMENT_PROJECT="$TMPDIR/provider-fragment-project"
PROVIDER_PLAIN_LOCK_HOME="$TMPDIR/provider-plain-lock-home"
PROVIDER_PLAIN_LOCK_PROJECT="$TMPDIR/provider-plain-lock-project"
PROVIDER_PLAIN_LIBRARY_HOME="$TMPDIR/provider-plain-library-home"
PROVIDER_PLAIN_LIBRARY_PROJECT="$TMPDIR/provider-plain-library-project"
PROVIDER_BAD_ID_HOME="$TMPDIR/provider-bad-id-home"
PROVIDER_BAD_ID_PROJECT="$TMPDIR/provider-bad-id-project"
PROVIDER_BAD_LOCK_ID_HOME="$TMPDIR/provider-bad-lock-id-home"
PROVIDER_BAD_LOCK_ID_PROJECT="$TMPDIR/provider-bad-lock-id-project"
PROVIDER_BAD_LOCK_DOTSEG_HOME="$TMPDIR/provider-bad-lock-dotseg-home"
PROVIDER_BAD_LOCK_DOTSEG_PROJECT="$TMPDIR/provider-bad-lock-dotseg-project"
PROVIDER_BAD_LIBRARY_ID_HOME="$TMPDIR/provider-bad-library-id-home"
PROVIDER_BAD_LIBRARY_ID_PROJECT="$TMPDIR/provider-bad-library-id-project"
PROVIDER_BAD_LIBRARY_DOTSEG_HOME="$TMPDIR/provider-bad-library-dotseg-home"
PROVIDER_BAD_LIBRARY_DOTSEG_PROJECT="$TMPDIR/provider-bad-library-dotseg-project"
mkdir -p "$PROVIDER_FAIL_HOME/.skillspm" "$PROVIDER_CLEAN_HOME/.skillspm" "$PROVIDER_CLEAN_PROJECT" "$PROVIDER_FIXTURE_ROOT/example" "$PROVIDER_WORKTREE" "$PROVIDER_REFRESH_PROJECT" "$PROVIDER_CRED_URL_HOME/.skillspm" "$PROVIDER_CRED_URL_PROJECT" "$PROVIDER_URL_HOME/.skillspm" "$PROVIDER_URL_PROJECT" "$PROVIDER_LOCK_HOME/.skillspm" "$PROVIDER_LOCK_PROJECT" "$PROVIDER_LOCK_PRIORITY_HOME/.skillspm" "$PROVIDER_LOCK_PRIORITY_PROJECT" "$PROVIDER_LOCK_CRED_HOME/.skillspm" "$PROVIDER_LOCK_CRED_PROJECT" "$PROVIDER_QUERY_HOME/.skillspm" "$PROVIDER_QUERY_PROJECT" "$PROVIDER_LOCK_QUERY_HOME/.skillspm" "$PROVIDER_LOCK_QUERY_PROJECT" "$PROVIDER_FRAGMENT_HOME/.skillspm" "$PROVIDER_FRAGMENT_PROJECT" "$PROVIDER_PLAIN_LOCK_HOME/.skillspm" "$PROVIDER_PLAIN_LOCK_PROJECT" "$PROVIDER_PLAIN_LIBRARY_HOME/.skillspm" "$PROVIDER_PLAIN_LIBRARY_PROJECT" "$PROVIDER_BAD_ID_HOME/.skillspm" "$PROVIDER_BAD_ID_PROJECT" "$PROVIDER_BAD_LOCK_ID_HOME/.skillspm" "$PROVIDER_BAD_LOCK_ID_PROJECT" "$PROVIDER_BAD_LOCK_DOTSEG_HOME/.skillspm" "$PROVIDER_BAD_LOCK_DOTSEG_PROJECT" "$PROVIDER_BAD_LIBRARY_ID_HOME/.skillspm" "$PROVIDER_BAD_LIBRARY_ID_PROJECT" "$PROVIDER_BAD_LIBRARY_DOTSEG_HOME/.skillspm" "$PROVIDER_BAD_LIBRARY_DOTSEG_PROJECT"

SKILLS_SH_WORKTREE="$TMPDIR/skills-sh-worktree"
OPENCLAW_WORKTREE="$TMPDIR/openclaw-worktree"
CLAWHUB_WORKTREE="$TMPDIR/clawhub-worktree"
mkdir -p "$SKILLS_SH_WORKTREE" "$OPENCLAW_WORKTREE" "$CLAWHUB_WORKTREE"

git init --bare "$PROVIDER_FIXTURE_ROOT/example/skills-sh-skill.git" > /dev/null
git --git-dir="$PROVIDER_FIXTURE_ROOT/example/skills-sh-skill.git" symbolic-ref HEAD refs/heads/main
git init "$SKILLS_SH_WORKTREE" > /dev/null
git -C "$SKILLS_SH_WORKTREE" config user.name "Smoke Test"
git -C "$SKILLS_SH_WORKTREE" config user.email "smoke@example.com"
git -C "$SKILLS_SH_WORKTREE" branch -m main
git -C "$SKILLS_SH_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/skills-sh-skill.git"
mkdir -p "$SKILLS_SH_WORKTREE/skills/demo-skill"
cat > "$SKILLS_SH_WORKTREE/skills/demo-skill/skill.yaml" <<'YAML'
id: skills.sh:acme/demo-skill
version: 1.5.0
YAML
cat > "$SKILLS_SH_WORKTREE/skills/demo-skill/SKILL.md" <<'EOF_SKILL'
# skills.sh demo
EOF_SKILL
printf 'skills-sh\n' > "$SKILLS_SH_WORKTREE/skills/demo-skill/materialization.txt"
(
  cd "$SKILLS_SH_WORKTREE"
  git add .
  git commit -m "skills.sh v1.5.0" > /dev/null
  git tag v1.5.0
  git push origin main --tags > /dev/null
)

git init --bare "$PROVIDER_FIXTURE_ROOT/example/openclaw-skill.git" > /dev/null
git --git-dir="$PROVIDER_FIXTURE_ROOT/example/openclaw-skill.git" symbolic-ref HEAD refs/heads/main
git init "$OPENCLAW_WORKTREE" > /dev/null
git -C "$OPENCLAW_WORKTREE" config user.name "Smoke Test"
git -C "$OPENCLAW_WORKTREE" config user.email "smoke@example.com"
git -C "$OPENCLAW_WORKTREE" branch -m main
git -C "$OPENCLAW_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/openclaw-skill.git"
mkdir -p "$OPENCLAW_WORKTREE/skills/provider-demo"
cat > "$OPENCLAW_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: openclaw:example/provider-demo
version: 2.1.0
YAML
cat > "$OPENCLAW_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# openclaw demo
EOF_SKILL
printf 'openclaw\n' > "$OPENCLAW_WORKTREE/skills/provider-demo/materialization.txt"
(
  cd "$OPENCLAW_WORKTREE"
  git add .
  git commit -m "openclaw v2.1.0" > /dev/null
  git tag v2.1.0
  git push origin main --tags > /dev/null
)

git init --bare "$PROVIDER_FIXTURE_ROOT/example/clawhub-skill.git" > /dev/null
git --git-dir="$PROVIDER_FIXTURE_ROOT/example/clawhub-skill.git" symbolic-ref HEAD refs/heads/main
git init "$CLAWHUB_WORKTREE" > /dev/null
git -C "$CLAWHUB_WORKTREE" config user.name "Smoke Test"
git -C "$CLAWHUB_WORKTREE" config user.email "smoke@example.com"
git -C "$CLAWHUB_WORKTREE" branch -m main
git -C "$CLAWHUB_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/clawhub-skill.git"
mkdir -p "$CLAWHUB_WORKTREE/skills/provider-demo"
cat > "$CLAWHUB_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: clawhub:example/provider-demo
version: 2.2.0
YAML
cat > "$CLAWHUB_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# clawhub demo
EOF_SKILL
printf 'clawhub\n' > "$CLAWHUB_WORKTREE/skills/provider-demo/materialization.txt"
(
  cd "$CLAWHUB_WORKTREE"
  git add .
  git commit -m "clawhub v2.2.0" > /dev/null
  git tag v2.2.0
  git push origin main --tags > /dev/null
)

(
  cd "$PROVIDER_SKILLS_SH_PROJECT"
  HOME="$PROVIDER_BOOTSTRAP_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_SKILLS_SH_BASE_URL="$PROVIDER_SKILLS_SH_BASE_URL" \
  "${CLI[@]}" add skills.sh:acme/demo-skill --install
)
assert_node "const [manifest, lockfile] = docs; const root = manifest.skills[0]; const entry = lockfile.skills['skills.sh:acme/demo-skill']; return manifest.skills.length === 1 && root.id === 'skills.sh:acme/demo-skill' && root.version === '1.5.0' && root.source.kind === 'provider' && root.source.value === 'skills.sh:acme/demo-skill' && root.source.provider.name === 'skills.sh' && root.source.provider.ref === 'github:example/skills-sh-skill/skills/demo-skill' && lockfile.schema === 'skills-lock/v3' && entry.version === '1.5.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/skills-sh-skill/skills/demo-skill';" "$PROVIDER_SKILLS_SH_PROJECT/skills.yaml" "$PROVIDER_SKILLS_SH_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['skills.sh:acme/demo-skill'].versions['1.5.0']; return entry.source.kind === 'provider' && entry.source.value === 'skills.sh:acme/demo-skill' && entry.source.provider.name === 'skills.sh' && entry.source.provider.ref === 'github:example/skills-sh-skill/skills/demo-skill' && entry.source.provider.visibility === 'public';" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/library.yaml"
grep -Fxq "skills-sh" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/skills/skills.sh_acme__demo-skill@1.5.0/materialization.txt"

(
  cd "$PROVIDER_OPENCLAW_PROJECT"
  HOME="$PROVIDER_BOOTSTRAP_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_BASE_URL" \
  "${CLI[@]}" add openclaw:example/provider-demo --install
)
assert_node "const [manifest, lockfile] = docs; const root = manifest.skills[0]; const entry = lockfile.skills['openclaw:example/provider-demo']; return manifest.skills.length === 1 && root.id === 'openclaw:example/provider-demo' && root.version === '2.1.0' && root.source.kind === 'provider' && root.source.value === 'openclaw:example/provider-demo' && root.source.provider.name === 'openclaw' && root.source.provider.ref === 'github:example/openclaw-skill/skills/provider-demo' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.1.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/openclaw-skill/skills/provider-demo';" "$PROVIDER_OPENCLAW_PROJECT/skills.yaml" "$PROVIDER_OPENCLAW_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['openclaw:example/provider-demo'].versions['2.1.0']; return entry.source.kind === 'provider' && entry.source.value === 'openclaw:example/provider-demo' && entry.source.provider.name === 'openclaw' && entry.source.provider.ref === 'github:example/openclaw-skill/skills/provider-demo' && entry.source.provider.visibility === 'public';" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/library.yaml"
grep -Fxq "openclaw" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/skills/openclaw_example__provider-demo@2.1.0/materialization.txt"

(
  cd "$PROVIDER_CLAWHUB_PROJECT"
  HOME="$PROVIDER_BOOTSTRAP_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_CLAWHUB_BASE_URL="$PROVIDER_CLAWHUB_BASE_URL" \
  "${CLI[@]}" add clawhub:example/provider-demo --install
)
assert_node "const [manifest, lockfile] = docs; const root = manifest.skills[0]; const entry = lockfile.skills['clawhub:example/provider-demo']; return manifest.skills.length === 1 && root.id === 'clawhub:example/provider-demo' && root.version === '2.2.0' && root.source.kind === 'provider' && root.source.value === 'clawhub:example/provider-demo' && root.source.provider.name === 'clawhub' && root.source.provider.ref === 'github:example/clawhub-skill/skills/provider-demo' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.2.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/clawhub-skill/skills/provider-demo';" "$PROVIDER_CLAWHUB_PROJECT/skills.yaml" "$PROVIDER_CLAWHUB_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['clawhub:example/provider-demo'].versions['2.2.0']; return entry.source.kind === 'provider' && entry.source.value === 'clawhub:example/provider-demo' && entry.source.provider.name === 'clawhub' && entry.source.provider.ref === 'github:example/clawhub-skill/skills/provider-demo' && entry.source.provider.visibility === 'public';" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/library.yaml"
grep -Fxq "clawhub" "$PROVIDER_BOOTSTRAP_HOME/.skillspm/skills/clawhub_example__provider-demo@2.2.0/materialization.txt"

(
  cd "$PROVIDER_OPENCLAW_PROJECT"
  HOME="$PROVIDER_BOOTSTRAP_CLEAN_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [library] = docs; const entry = library.skills['openclaw:example/provider-demo'].versions['2.1.0']; return entry.source.kind === 'provider' && entry.source.value === 'openclaw:example/provider-demo' && entry.source.provider.name === 'openclaw' && entry.source.provider.ref === 'github:example/openclaw-skill/skills/provider-demo' && entry.source.provider.visibility === 'public';" "$PROVIDER_BOOTSTRAP_CLEAN_HOME/.skillspm/library.yaml"
grep -Fxq "openclaw" "$PROVIDER_BOOTSTRAP_CLEAN_HOME/.skillspm/skills/openclaw_example__provider-demo@2.1.0/materialization.txt"

cat > "$PROVIDER_RECORDED_SKILLS_SH_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: skills.sh:acme/demo-skill
    version: 1.5.0
    source:
      kind: provider
      value: skills.sh:acme/demo-skill
      provider:
        name: skills.sh
        ref: github:example/skills-sh-skill/skills/demo-skill
        visibility: public
YAML
(
  cd "$PROVIDER_RECORDED_SKILLS_SH_PROJECT"
  HOME="$PROVIDER_RECORDED_SKILLS_SH_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_SKILLS_SH_BASE_URL="$PROVIDER_SKILLS_SH_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['skills.sh:acme/demo-skill']; return entry.version === '1.5.0' && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/skills-sh-skill/skills/demo-skill';" "$PROVIDER_RECORDED_SKILLS_SH_PROJECT/skills.lock"

cat > "$PROVIDER_RECORDED_OPENCLAW_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: openclaw:example/provider-demo
    version: 2.1.0
    source:
      kind: provider
      value: openclaw:example/provider-demo
      provider:
        name: openclaw
        ref: github:example/openclaw-skill/skills/provider-demo
        visibility: public
YAML
(
  cd "$PROVIDER_RECORDED_OPENCLAW_PROJECT"
  HOME="$PROVIDER_RECORDED_OPENCLAW_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['openclaw:example/provider-demo']; return entry.version === '2.1.0' && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/openclaw-skill/skills/provider-demo';" "$PROVIDER_RECORDED_OPENCLAW_PROJECT/skills.lock"

cat > "$PROVIDER_RECORDED_CLAWHUB_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: clawhub:example/provider-demo
    version: 2.2.0
    source:
      kind: provider
      value: clawhub:example/provider-demo
      provider:
        name: clawhub
        ref: github:example/clawhub-skill/skills/provider-demo
        visibility: public
YAML
(
  cd "$PROVIDER_RECORDED_CLAWHUB_PROJECT"
  HOME="$PROVIDER_RECORDED_CLAWHUB_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_CLAWHUB_BASE_URL="$PROVIDER_CLAWHUB_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['clawhub:example/provider-demo']; return entry.version === '2.2.0' && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/clawhub-skill/skills/provider-demo';" "$PROVIDER_RECORDED_CLAWHUB_PROJECT/skills.lock"

cat > "$PROVIDER_DIRECT_SKILLS_SH_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: skills.sh:acme/demo-skill
YAML
(
  cd "$PROVIDER_DIRECT_SKILLS_SH_PROJECT"
  HOME="$PROVIDER_DIRECT_SKILLS_SH_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_SKILLS_SH_BASE_URL="$PROVIDER_SKILLS_SH_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [lockfile, library] = docs; const lock = lockfile.skills['skills.sh:acme/demo-skill']; const lib = library.skills['skills.sh:acme/demo-skill'].versions['1.5.0']; return lock.version === '1.5.0' && lock.resolved_from.type === 'provider' && lock.resolved_from.ref === 'github:example/skills-sh-skill/skills/demo-skill' && lib.source.kind === 'provider' && lib.source.value === 'skills.sh:acme/demo-skill' && lib.source.provider.name === 'skills.sh' && lib.source.provider.ref === 'github:example/skills-sh-skill/skills/demo-skill';" "$PROVIDER_DIRECT_SKILLS_SH_PROJECT/skills.lock" "$PROVIDER_DIRECT_SKILLS_SH_HOME/.skillspm/library.yaml"
grep -Fxq "skills-sh" "$PROVIDER_DIRECT_SKILLS_SH_HOME/.skillspm/skills/skills.sh_acme__demo-skill@1.5.0/materialization.txt"

cat > "$PROVIDER_DIRECT_OPENCLAW_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: openclaw:example/provider-demo
    version: ^2.0.0
YAML
(
  cd "$PROVIDER_DIRECT_OPENCLAW_PROJECT"
  HOME="$PROVIDER_DIRECT_OPENCLAW_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_BASE_URL" \
  "${CLI[@]}" install
)
assert_node "const [lockfile, library] = docs; const lock = lockfile.skills['openclaw:example/provider-demo']; const lib = library.skills['openclaw:example/provider-demo'].versions['2.1.0']; return lock.version === '2.1.0' && lock.resolved_from.type === 'provider' && lock.resolved_from.ref === 'github:example/openclaw-skill/skills/provider-demo' && lib.source.kind === 'provider' && lib.source.value === 'openclaw:example/provider-demo' && lib.source.provider.name === 'openclaw' && lib.source.provider.ref === 'github:example/openclaw-skill/skills/provider-demo';" "$PROVIDER_DIRECT_OPENCLAW_PROJECT/skills.lock" "$PROVIDER_DIRECT_OPENCLAW_HOME/.skillspm/library.yaml"
grep -Fxq "openclaw" "$PROVIDER_DIRECT_OPENCLAW_HOME/.skillspm/skills/openclaw_example__provider-demo@2.1.0/materialization.txt"

(
  cd "$PROVIDER_BOOTSTRAP_FAIL_PROJECT"
  set +e
  HOME="$PROVIDER_BOOTSTRAP_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  SKILLSPM_TEST_OPENCLAW_BASE_URL="$PROVIDER_OPENCLAW_BASE_URL" \
  "${CLI[@]}" add openclaw:example/no-github --install > "$TMPDIR/provider-bootstrap-fail.out" 2> "$TMPDIR/provider-bootstrap-fail.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "public openclaw bootstrap is insufficient for example/no-github" "$TMPDIR/provider-bootstrap-fail.err"
[ -f "$PROVIDER_BOOTSTRAP_FAIL_PROJECT/skills.yaml" ]
assert_node "const [manifest] = docs; return Array.isArray(manifest.skills) && manifest.skills.length === 0;" "$PROVIDER_BOOTSTRAP_FAIL_PROJECT/skills.yaml"

git init --bare "$PROVIDER_FIXTURE_ROOT/example/public-skill.git" > /dev/null
git init "$PROVIDER_WORKTREE" > /dev/null
git -C "$PROVIDER_WORKTREE" config user.name "Smoke Test"
git -C "$PROVIDER_WORKTREE" config user.email "smoke@example.com"
git -C "$PROVIDER_WORKTREE" branch -m main
git -C "$PROVIDER_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/public-skill.git"

mkdir -p "$PROVIDER_WORKTREE/skills/provider-demo"
cat > "$PROVIDER_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: github:example/public-skill/skills/provider-demo
version: 1.0.0
YAML
cat > "$PROVIDER_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# Provider demo v1
EOF_SKILL
printf 'provider-v1\n' > "$PROVIDER_WORKTREE/skills/provider-demo/materialization.txt"
(
  cd "$PROVIDER_WORKTREE"
  git add .
  git commit -m "provider v1" > /dev/null
  git tag v1.0.0
  git push origin main --tags > /dev/null
)

cat > "$PROVIDER_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: github:example/public-skill/skills/provider-demo
version: 2.0.0
YAML
cat > "$PROVIDER_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# Provider demo v2
EOF_SKILL
printf 'provider-v2\n' > "$PROVIDER_WORKTREE/skills/provider-demo/materialization.txt"
(
  cd "$PROVIDER_WORKTREE"
  git add .
  git commit -m "provider v2" > /dev/null
  git tag v2.0.0
  git push origin main --tags > /dev/null
)

cat > "$PROVIDER_CLEAN_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
(
  cd "$PROVIDER_CLEAN_PROJECT"
  HOME="$PROVIDER_CLEAN_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [manifest, lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return manifest.skills.length === 1 && manifest.skills[0].id === 'github:example/public-skill/skills/provider-demo' && manifest.skills[0].version === '2.0.0' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/public-skill/skills/provider-demo';" "$PROVIDER_CLEAN_PROJECT/skills.yaml" "$PROVIDER_CLEAN_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'github:example/public-skill/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_CLEAN_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2" "$PROVIDER_CLEAN_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

cat > "$PROVIDER_REFRESH_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_FAIL_HOME/.skillspm/library.yaml" "$PROVIDER_FAIL_HOME" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [outFile, homeDir] = process.argv.slice(2);
const doc = {
  schema: 'skills-library/v1',
  skills: {
    'github:example/public-skill/skills/provider-demo': {
      versions: {
        '2.0.0': {
          path: `${homeDir}/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0`,
          cached_at: '2026-03-16T00:00:00.000Z',
          source: {
            kind: 'provider',
            value: 'github:example/public-skill/skills/provider-demo',
            provider: {
              name: 'github',
              ref: 'refs/tags/v2.0.0',
              visibility: 'public'
            }
          }
        }
      }
    }
  }
};
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE

(
  cd "$PROVIDER_REFRESH_PROJECT"
  HOME="$PROVIDER_FAIL_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [manifest, lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return manifest.skills.length === 1 && manifest.skills[0].id === 'github:example/public-skill/skills/provider-demo' && manifest.skills[0].version === '2.0.0' && lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/public-skill/skills/provider-demo';" "$PROVIDER_REFRESH_PROJECT/skills.yaml" "$PROVIDER_REFRESH_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'github:example/public-skill/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_FAIL_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2" "$PROVIDER_FAIL_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

cat > "$PROVIDER_URL_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_URL_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: https://github.com/example/public-skill/tree/main/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_URL_PROJECT"
  HOME="$PROVIDER_URL_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'https://github.com/example/public-skill/tree/main/skills/provider-demo';" "$PROVIDER_URL_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://github.com/example/public-skill/tree/main/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_URL_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2" "$PROVIDER_URL_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

cat > "$PROVIDER_LOCK_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cp "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_LOCK_PROJECT/skills.lock"
(
  cd "$PROVIDER_LOCK_PROJECT"
  HOME="$PROVIDER_LOCK_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'https://github.com/example/public-skill/tree/main/skills/provider-demo';" "$PROVIDER_LOCK_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://github.com/example/public-skill/tree/main/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_LOCK_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2" "$PROVIDER_LOCK_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

cat > "$PROVIDER_LOCK_PRIORITY_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cp "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_LOCK_PRIORITY_PROJECT/skills.lock"
cat > "$PROVIDER_LOCK_PRIORITY_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/public-skill/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_LOCK_PRIORITY_PROJECT"
  HOME="$PROVIDER_LOCK_PRIORITY_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'https://github.com/example/public-skill/tree/main/skills/provider-demo';" "$PROVIDER_LOCK_PRIORITY_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://github.com/example/public-skill/tree/main/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_LOCK_PRIORITY_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2" "$PROVIDER_LOCK_PRIORITY_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

PROVIDER_CRED_URL_HELPER_LOG="$TMPDIR/provider-credential-url-helper.log"
PROVIDER_CRED_URL_ASKPASS_LOG="$TMPDIR/provider-credential-url-askpass.log"
PROVIDER_CRED_URL_HELPER="$TMPDIR/provider-credential-url-helper.sh"
PROVIDER_CRED_URL_ASKPASS="$TMPDIR/provider-credential-url-askpass.sh"
PROVIDER_CRED_URL_USER="provider-user"
PROVIDER_CRED_URL_TOKEN="provider-token"

cat > "$PROVIDER_CRED_URL_HELPER" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\${1:-}" >> "$PROVIDER_CRED_URL_HELPER_LOG"
cat > /dev/null
if [ "\${1:-}" = get ]; then
  printf 'username=%s\n' "$PROVIDER_CRED_URL_USER"
  printf 'password=%s\n' "$PROVIDER_CRED_URL_TOKEN"
fi
EOF
chmod +x "$PROVIDER_CRED_URL_HELPER"

cat > "$PROVIDER_CRED_URL_ASKPASS" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\${1:-}" >> "$PROVIDER_CRED_URL_ASKPASS_LOG"
case "\${1:-}" in
  Username*) printf '%s\n' "$PROVIDER_CRED_URL_USER" ;;
  Password*) printf '%s\n' "$PROVIDER_CRED_URL_TOKEN" ;;
  *) printf '\n' ;;
esac
EOF
chmod +x "$PROVIDER_CRED_URL_ASKPASS"

cat > "$PROVIDER_CRED_URL_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_CRED_URL_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "https://$PROVIDER_CRED_URL_USER:$PROVIDER_CRED_URL_TOKEN@github.com/example/public-skill/tree/main/skills/provider-demo"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_CRED_URL_PROJECT"
  set +e
  HOME="$PROVIDER_CRED_URL_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  GIT_CONFIG_COUNT=2 \
  GIT_CONFIG_KEY_0=credential.helper \
  GIT_CONFIG_VALUE_0="!$PROVIDER_CRED_URL_HELPER" \
  GIT_CONFIG_KEY_1=core.askPass \
  GIT_CONFIG_VALUE_1="$PROVIDER_CRED_URL_ASKPASS" \
  GIT_ASKPASS="$PROVIDER_CRED_URL_ASKPASS" \
  "${CLI[@]}" install > "$TMPDIR/provider-credential-url.out" 2> "$TMPDIR/provider-credential-url.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-credential-url.err"
[ ! -d "$PROVIDER_CRED_URL_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -s "$PROVIDER_CRED_URL_HELPER_LOG" ]
[ ! -s "$PROVIDER_CRED_URL_ASKPASS_LOG" ]
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://$PROVIDER_CRED_URL_USER:$PROVIDER_CRED_URL_TOKEN@github.com/example/public-skill/tree/main/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_CRED_URL_HOME/.skillspm/library.yaml"

cat > "$PROVIDER_LOCK_CRED_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_LOCK_CRED_PROJECT/skills.lock" "$PROVIDER_CRED_URL_USER" "$PROVIDER_CRED_URL_TOKEN" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [inFile, outFile, user, token] = process.argv.slice(2);
const doc = YAML.parse(fs.readFileSync(inFile, 'utf8'));
doc.skills['github:example/public-skill/skills/provider-demo'].resolved_from.ref =
  `https://${user}:${token}@github.com/example/public-skill/tree/main/skills/provider-demo`;
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE
(
  cd "$PROVIDER_LOCK_CRED_PROJECT"
  set +e
  HOME="$PROVIDER_LOCK_CRED_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" \
  GIT_CONFIG_COUNT=2 \
  GIT_CONFIG_KEY_0=credential.helper \
  GIT_CONFIG_VALUE_0="!$PROVIDER_CRED_URL_HELPER" \
  GIT_CONFIG_KEY_1=core.askPass \
  GIT_CONFIG_VALUE_1="$PROVIDER_CRED_URL_ASKPASS" \
  GIT_ASKPASS="$PROVIDER_CRED_URL_ASKPASS" \
  "${CLI[@]}" install > "$TMPDIR/provider-lock-credential-url.out" 2> "$TMPDIR/provider-lock-credential-url.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "locked provider provenance is insufficient for public github recovery: expected resolved_from.ref to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-lock-credential-url.err"
[ ! -d "$PROVIDER_LOCK_CRED_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -s "$PROVIDER_CRED_URL_HELPER_LOG" ]
[ ! -s "$PROVIDER_CRED_URL_ASKPASS_LOG" ]

cat > "$PROVIDER_QUERY_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_QUERY_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "https://github.com/example/public-skill/tree/main/skills/provider-demo?token=provider-token"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_QUERY_PROJECT"
  set +e
  HOME="$PROVIDER_QUERY_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-query.out" 2> "$TMPDIR/provider-query.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-query.err"
[ ! -d "$PROVIDER_QUERY_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_QUERY_PROJECT/skills.lock" ]
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://github.com/example/public-skill/tree/main/skills/provider-demo?token=provider-token' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_QUERY_HOME/.skillspm/library.yaml"

cat > "$PROVIDER_LOCK_QUERY_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_LOCK_QUERY_PROJECT/skills.lock" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [inFile, outFile] = process.argv.slice(2);
const doc = YAML.parse(fs.readFileSync(inFile, 'utf8'));
doc.skills['github:example/public-skill/skills/provider-demo'].resolved_from.ref =
  'https://github.com/example/public-skill/tree/main/skills/provider-demo?token=provider-token';
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE
(
  cd "$PROVIDER_LOCK_QUERY_PROJECT"
  set +e
  HOME="$PROVIDER_LOCK_QUERY_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-lock-query.out" 2> "$TMPDIR/provider-lock-query.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "locked provider provenance is insufficient for public github recovery: expected resolved_from.ref to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-lock-query.err"
[ ! -d "$PROVIDER_LOCK_QUERY_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_LOCK_QUERY_HOME/.skillspm/library.yaml" ]
assert_node "const [lockfile] = docs; return lockfile.skills['github:example/public-skill/skills/provider-demo'].resolved_from.ref === 'https://github.com/example/public-skill/tree/main/skills/provider-demo?token=provider-token';" "$PROVIDER_LOCK_QUERY_PROJECT/skills.lock"

cat > "$PROVIDER_FRAGMENT_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_FRAGMENT_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "https://github.com/example/public-skill/tree/main/skills/provider-demo#fragment"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_FRAGMENT_PROJECT"
  set +e
  HOME="$PROVIDER_FRAGMENT_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-fragment.out" 2> "$TMPDIR/provider-fragment.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization: expected source.value to be either a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-fragment.err"
[ ! -d "$PROVIDER_FRAGMENT_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_FRAGMENT_PROJECT/skills.lock" ]
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'https://github.com/example/public-skill/tree/main/skills/provider-demo#fragment' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_FRAGMENT_HOME/.skillspm/library.yaml"

cat > "$PROVIDER_PLAIN_LOCK_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: example/plain-provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_PLAIN_LOCK_PROJECT/skills.lock" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [inFile, outFile] = process.argv.slice(2);
const doc = YAML.parse(fs.readFileSync(inFile, 'utf8'));
const entry = doc.skills['github:example/public-skill/skills/provider-demo'];
doc.skills = {
  'example/plain-provider-demo': {
    version: entry.version,
    digest: entry.digest,
    resolved_from: {
      type: 'provider',
      ref: 'github:example/public-skill/skills/provider-demo'
    }
  }
};
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE
(
  cd "$PROVIDER_PLAIN_LOCK_PROJECT"
  set +e
  HOME="$PROVIDER_PLAIN_LOCK_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-plain-lock.out" 2> "$TMPDIR/provider-plain-lock.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "provider recovery is only supported for explicit public provider skill ids" "$TMPDIR/provider-plain-lock.err"
[ ! -d "$PROVIDER_PLAIN_LOCK_HOME/.skillspm/skills/example__plain-provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_PLAIN_LOCK_HOME/.skillspm/library.yaml" ]

cat > "$PROVIDER_PLAIN_LIBRARY_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: example/plain-provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_PLAIN_LIBRARY_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "example/plain-provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-plain-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "github:example/public-skill/skills/provider-demo"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_PLAIN_LIBRARY_PROJECT"
  set +e
  HOME="$PROVIDER_PLAIN_LIBRARY_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-plain-library.out" 2> "$TMPDIR/provider-plain-library.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "provider recovery is only supported for explicit public provider skill ids" "$TMPDIR/provider-plain-library.err"
[ ! -d "$PROVIDER_PLAIN_LIBRARY_HOME/.skillspm/skills/example__plain-provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_PLAIN_LIBRARY_PROJECT/skills.lock" ]

cat > "$PROVIDER_BAD_ID_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo#fragment
    version: 2.0.0
YAML
(
  cd "$PROVIDER_BAD_ID_PROJECT"
  set +e
  HOME="$PROVIDER_BAD_ID_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-bad-id.out" 2> "$TMPDIR/provider-bad-id.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "is not a canonical public github id" "$TMPDIR/provider-bad-id.err"
[ ! -f "$PROVIDER_BAD_ID_PROJECT/skills.lock" ]

cat > "$PROVIDER_BAD_LOCK_ID_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_BAD_LOCK_ID_PROJECT/skills.lock" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [inFile, outFile] = process.argv.slice(2);
const doc = YAML.parse(fs.readFileSync(inFile, 'utf8'));
doc.skills['github:example/public-skill/skills/provider-demo'].resolved_from.ref =
  'github:example/public-skill/skills/provider-demo?token=provider-token';
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE
(
  cd "$PROVIDER_BAD_LOCK_ID_PROJECT"
  set +e
  HOME="$PROVIDER_BAD_LOCK_ID_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-bad-lock-id.out" 2> "$TMPDIR/provider-bad-lock-id.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "locked provider provenance is insufficient for public github recovery" "$TMPDIR/provider-bad-lock-id.err"
[ ! -d "$PROVIDER_BAD_LOCK_ID_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]

cat > "$PROVIDER_BAD_LOCK_DOTSEG_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_URL_PROJECT/skills.lock" "$PROVIDER_BAD_LOCK_DOTSEG_PROJECT/skills.lock" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [inFile, outFile] = process.argv.slice(2);
const doc = YAML.parse(fs.readFileSync(inFile, 'utf8'));
doc.skills['github:example/public-skill/skills/provider-demo'].resolved_from.ref =
  'github:example/public-skill/%2e%2e/provider-demo';
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE
(
  cd "$PROVIDER_BAD_LOCK_DOTSEG_PROJECT"
  set +e
  HOME="$PROVIDER_BAD_LOCK_DOTSEG_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-bad-lock-dotseg.out" 2> "$TMPDIR/provider-bad-lock-dotseg.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "locked provider provenance is insufficient for public github recovery" "$TMPDIR/provider-bad-lock-dotseg.err"
[ ! -d "$PROVIDER_BAD_LOCK_DOTSEG_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]

cat > "$PROVIDER_BAD_LIBRARY_ID_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_BAD_LIBRARY_ID_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-bad-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "github:example/public-skill/skills/provider-demo#fragment"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_BAD_LIBRARY_ID_PROJECT"
  set +e
  HOME="$PROVIDER_BAD_LIBRARY_ID_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-bad-library-id.out" 2> "$TMPDIR/provider-bad-library-id.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization" "$TMPDIR/provider-bad-library-id.err"
[ ! -d "$PROVIDER_BAD_LIBRARY_ID_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_BAD_LIBRARY_ID_PROJECT/skills.lock" ]

cat > "$PROVIDER_BAD_LIBRARY_DOTSEG_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_BAD_LIBRARY_DOTSEG_HOME/.skillspm/library.yaml" <<'YAML'
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: /tmp/missing-bad-provider-cache
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: "https://github.com/example/public-skill/%2e%2e/provider-demo"
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_BAD_LIBRARY_DOTSEG_PROJECT"
  set +e
  HOME="$PROVIDER_BAD_LIBRARY_DOTSEG_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-bad-library-dotseg.out" 2> "$TMPDIR/provider-bad-library-dotseg.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization" "$TMPDIR/provider-bad-library-dotseg.err"
[ ! -d "$PROVIDER_BAD_LIBRARY_DOTSEG_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
[ ! -f "$PROVIDER_BAD_LIBRARY_DOTSEG_PROJECT/skills.lock" ]

cat > "$PROVIDER_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: github:example/public-skill/skills/provider-demo
version: 2.0.0
YAML
cat > "$PROVIDER_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# Provider demo v2 retagged
EOF_SKILL
printf 'provider-v2-mismatch\n' > "$PROVIDER_WORKTREE/skills/provider-demo/materialization.txt"
(
  cd "$PROVIDER_WORKTREE"
  git add .
  git commit -m "provider v2 mismatch" > /dev/null
  git tag -f v2.0.0 > /dev/null
  git push origin main --force > /dev/null
  git push origin refs/tags/v2.0.0 --force > /dev/null
)

rm -rf "$PROVIDER_FAIL_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0"
(
  cd "$PROVIDER_REFRESH_PROJECT"
  set +e
  HOME="$PROVIDER_FAIL_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-digest.out" 2> "$TMPDIR/provider-digest.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "failed closed: digest mismatch" "$TMPDIR/provider-digest.err"
[ ! -d "$PROVIDER_FAIL_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]

PROVIDER_INSUFFICIENT_HOME="$TMPDIR/provider-insufficient-home"
PROVIDER_INSUFFICIENT_PROJECT="$TMPDIR/provider-insufficient-project"
mkdir -p "$PROVIDER_INSUFFICIENT_HOME/.skillspm" "$PROVIDER_INSUFFICIENT_PROJECT"
cat > "$PROVIDER_INSUFFICIENT_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
node --input-type=module - "$PROVIDER_INSUFFICIENT_HOME/.skillspm/library.yaml" <<'NODE'
import fs from 'node:fs';
import * as YAML from 'yaml';

const [outFile] = process.argv.slice(2);
const doc = {
  schema: 'skills-library/v1',
  skills: {
    'github:example/public-skill/skills/provider-demo': {
      versions: {
        '2.0.0': {
          path: '/tmp/missing-provider-cache',
          cached_at: '2026-03-16T00:00:00.000Z',
          source: {
            kind: 'provider',
            value: 'github:example/public-skill/skills/provider-demo',
            provider: {
              name: 'github',
              visibility: 'public'
            }
          }
        }
      }
    }
  }
};
fs.writeFileSync(outFile, YAML.stringify(doc, { defaultKeyType: 'QUOTE_DOUBLE' }), 'utf8');
NODE

(
  cd "$PROVIDER_INSUFFICIENT_PROJECT"
  HOME="$PROVIDER_INSUFFICIENT_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install
)
assert_node "const [lockfile] = docs; const entry = lockfile.skills['github:example/public-skill/skills/provider-demo']; return lockfile.schema === 'skills-lock/v3' && entry.version === '2.0.0' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'provider' && entry.resolved_from.ref === 'github:example/public-skill/skills/provider-demo';" "$PROVIDER_INSUFFICIENT_PROJECT/skills.lock"
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'github:example/public-skill/skills/provider-demo' && entry.source.provider.name === 'github' && (entry.source.provider.ref === undefined || entry.source.provider.ref === 'refs/tags/v2.0.0') && entry.source.provider.visibility === 'public';" "$PROVIDER_INSUFFICIENT_HOME/.skillspm/library.yaml"
grep -Fxq "provider-v2-mismatch" "$PROVIDER_INSUFFICIENT_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0/materialization.txt"

PROVIDER_PRIVATE_HOME="$TMPDIR/provider-private-home"
PROVIDER_PRIVATE_PROJECT="$TMPDIR/provider-private-project"
mkdir -p "$PROVIDER_PRIVATE_HOME/.skillspm" "$PROVIDER_PRIVATE_PROJECT"
cat > "$PROVIDER_PRIVATE_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_PRIVATE_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: $PROVIDER_PRIVATE_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/public-skill/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v2.0.0
            visibility: private
YAML
(
  cd "$PROVIDER_PRIVATE_PROJECT"
  set +e
  HOME="$PROVIDER_PRIVATE_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-private.out" 2> "$TMPDIR/provider-private.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization: public provider recovery only supports source.provider.visibility=public" "$TMPDIR/provider-private.err"
[ ! -d "$PROVIDER_PRIVATE_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'github:example/public-skill/skills/provider-demo' && entry.source.provider.name === 'github' && entry.source.provider.ref === 'refs/tags/v2.0.0' && entry.source.provider.visibility === 'private';" "$PROVIDER_PRIVATE_HOME/.skillspm/library.yaml"

PROVIDER_NON_GITHUB_HOME="$TMPDIR/provider-non-github-home"
PROVIDER_NON_GITHUB_PROJECT="$TMPDIR/provider-non-github-project"
mkdir -p "$PROVIDER_NON_GITHUB_HOME/.skillspm" "$PROVIDER_NON_GITHUB_PROJECT"
cat > "$PROVIDER_NON_GITHUB_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: 2.0.0
YAML
cat > "$PROVIDER_NON_GITHUB_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/public-skill/skills/provider-demo":
    versions:
      2.0.0:
        path: $PROVIDER_NON_GITHUB_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/public-skill/skills/provider-demo
          provider:
            name: openclaw
            ref: example/provider-demo@2.0.0
            visibility: public
YAML
(
  cd "$PROVIDER_NON_GITHUB_PROJECT"
  set +e
  HOME="$PROVIDER_NON_GITHUB_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-non-github.out" 2> "$TMPDIR/provider-non-github.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization: expected source.provider.ref to be a canonical github:owner/repo[/path] id or an anonymous public https://github.com/owner/repo[/path] locator" "$TMPDIR/provider-non-github.err"
[ ! -d "$PROVIDER_NON_GITHUB_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]
assert_node "const [library] = docs; const entry = library.skills['github:example/public-skill/skills/provider-demo'].versions['2.0.0']; return entry.source.kind === 'provider' && entry.source.value === 'github:example/public-skill/skills/provider-demo' && entry.source.provider.name === 'openclaw' && entry.source.provider.ref === 'example/provider-demo@2.0.0' && entry.source.provider.visibility === 'public';" "$PROVIDER_NON_GITHUB_HOME/.skillspm/library.yaml"

PROVIDER_UNVERSIONED_HOME="$TMPDIR/provider-unversioned-home"
PROVIDER_UNVERSIONED_PROJECT="$TMPDIR/provider-unversioned-project"
mkdir -p "$PROVIDER_UNVERSIONED_HOME/.skillspm" "$PROVIDER_UNVERSIONED_PROJECT"
cat > "$PROVIDER_UNVERSIONED_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-skill/skills/provider-demo
    version: unversioned
YAML
(
  cd "$PROVIDER_UNVERSIONED_PROJECT"
  set +e
  HOME="$PROVIDER_UNVERSIONED_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-unversioned.out" 2> "$TMPDIR/provider-unversioned.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "persisted project semantics are insufficient for public provider recovery" "$TMPDIR/provider-unversioned.err"
[ ! -d "$PROVIDER_UNVERSIONED_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@unversioned" ]

PROVIDER_SYMLINK_ABS_HOME="$TMPDIR/provider-symlink-abs-home"
PROVIDER_SYMLINK_ABS_PROJECT="$TMPDIR/provider-symlink-abs-project"
PROVIDER_SYMLINK_ABS_WORKTREE="$TMPDIR/provider-symlink-abs-worktree"
mkdir -p "$PROVIDER_SYMLINK_ABS_HOME/.skillspm" "$PROVIDER_SYMLINK_ABS_PROJECT" "$PROVIDER_SYMLINK_ABS_WORKTREE"

git init --bare "$PROVIDER_FIXTURE_ROOT/example/public-symlink-abs.git" > /dev/null
git init "$PROVIDER_SYMLINK_ABS_WORKTREE" > /dev/null
git -C "$PROVIDER_SYMLINK_ABS_WORKTREE" config user.name "Smoke Test"
git -C "$PROVIDER_SYMLINK_ABS_WORKTREE" config user.email "smoke@example.com"
git -C "$PROVIDER_SYMLINK_ABS_WORKTREE" branch -m main
git -C "$PROVIDER_SYMLINK_ABS_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/public-symlink-abs.git"

mkdir -p "$PROVIDER_SYMLINK_ABS_WORKTREE/skills/provider-demo"
cat > "$PROVIDER_SYMLINK_ABS_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: github:example/public-symlink-abs/skills/provider-demo
version: 1.0.0
YAML
cat > "$PROVIDER_SYMLINK_ABS_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# Provider symlink abs
EOF_SKILL
ln -s /etc/passwd "$PROVIDER_SYMLINK_ABS_WORKTREE/skills/provider-demo/exfil.txt"
(
  cd "$PROVIDER_SYMLINK_ABS_WORKTREE"
  git add .
  git commit -m "provider symlink abs" > /dev/null
  git tag v1.0.0
  git push origin main --tags > /dev/null
)

cat > "$PROVIDER_SYMLINK_ABS_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-symlink-abs/skills/provider-demo
    version: 1.0.0
YAML
cat > "$PROVIDER_SYMLINK_ABS_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/public-symlink-abs/skills/provider-demo":
    versions:
      1.0.0:
        path: $PROVIDER_SYMLINK_ABS_HOME/.skillspm/skills/github_example__public-symlink-abs__skills__provider-demo@1.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/public-symlink-abs/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v1.0.0
            visibility: public
YAML

(
  cd "$PROVIDER_SYMLINK_ABS_PROJECT"
  set +e
  HOME="$PROVIDER_SYMLINK_ABS_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-symlink-abs.out" 2> "$TMPDIR/provider-symlink-abs.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "contains a symbolic link at exfil.txt -> /etc/passwd" "$TMPDIR/provider-symlink-abs.err"
[ ! -d "$PROVIDER_SYMLINK_ABS_HOME/.skillspm/skills/github_example__public-symlink-abs__skills__provider-demo@1.0.0" ]

PROVIDER_SYMLINK_ESCAPE_HOME="$TMPDIR/provider-symlink-escape-home"
PROVIDER_SYMLINK_ESCAPE_PROJECT="$TMPDIR/provider-symlink-escape-project"
PROVIDER_SYMLINK_ESCAPE_WORKTREE="$TMPDIR/provider-symlink-escape-worktree"
mkdir -p "$PROVIDER_SYMLINK_ESCAPE_HOME/.skillspm" "$PROVIDER_SYMLINK_ESCAPE_PROJECT" "$PROVIDER_SYMLINK_ESCAPE_WORKTREE"

git init --bare "$PROVIDER_FIXTURE_ROOT/example/public-symlink-escape.git" > /dev/null
git init "$PROVIDER_SYMLINK_ESCAPE_WORKTREE" > /dev/null
git -C "$PROVIDER_SYMLINK_ESCAPE_WORKTREE" config user.name "Smoke Test"
git -C "$PROVIDER_SYMLINK_ESCAPE_WORKTREE" config user.email "smoke@example.com"
git -C "$PROVIDER_SYMLINK_ESCAPE_WORKTREE" branch -m main
git -C "$PROVIDER_SYMLINK_ESCAPE_WORKTREE" remote add origin "$PROVIDER_FIXTURE_ROOT/example/public-symlink-escape.git"

mkdir -p "$PROVIDER_SYMLINK_ESCAPE_WORKTREE/skills/provider-demo"
cat > "$PROVIDER_SYMLINK_ESCAPE_WORKTREE/skills/provider-demo/skill.yaml" <<'YAML'
id: github:example/public-symlink-escape/skills/provider-demo
version: 1.0.0
YAML
cat > "$PROVIDER_SYMLINK_ESCAPE_WORKTREE/skills/provider-demo/SKILL.md" <<'EOF_SKILL'
# Provider symlink escape
EOF_SKILL
printf 'outside\n' > "$PROVIDER_SYMLINK_ESCAPE_WORKTREE/skills/outside.txt"
ln -s ../outside.txt "$PROVIDER_SYMLINK_ESCAPE_WORKTREE/skills/provider-demo/exfil.txt"
(
  cd "$PROVIDER_SYMLINK_ESCAPE_WORKTREE"
  git add .
  git commit -m "provider symlink escape" > /dev/null
  git tag v1.0.0
  git push origin main --tags > /dev/null
)

cat > "$PROVIDER_SYMLINK_ESCAPE_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/public-symlink-escape/skills/provider-demo
    version: 1.0.0
YAML
cat > "$PROVIDER_SYMLINK_ESCAPE_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/public-symlink-escape/skills/provider-demo":
    versions:
      1.0.0:
        path: $PROVIDER_SYMLINK_ESCAPE_HOME/.skillspm/skills/github_example__public-symlink-escape__skills__provider-demo@1.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/public-symlink-escape/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v1.0.0
            visibility: public
YAML

(
  cd "$PROVIDER_SYMLINK_ESCAPE_PROJECT"
  set +e
  HOME="$PROVIDER_SYMLINK_ESCAPE_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-symlink-escape.out" 2> "$TMPDIR/provider-symlink-escape.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "contains a symbolic link at exfil.txt -> ../outside.txt" "$TMPDIR/provider-symlink-escape.err"
[ ! -d "$PROVIDER_SYMLINK_ESCAPE_HOME/.skillspm/skills/github_example__public-symlink-escape__skills__provider-demo@1.0.0" ]

PROVIDER_AUTH_HOME="$TMPDIR/provider-auth-home"
PROVIDER_AUTH_PROJECT="$TMPDIR/provider-auth-project"
PROVIDER_AUTH_HELPER_LOG="$TMPDIR/provider-auth-helper.log"
PROVIDER_AUTH_ASKPASS_LOG="$TMPDIR/provider-auth-askpass.log"
PROVIDER_AUTH_HELPER="$TMPDIR/provider-auth-helper.sh"
PROVIDER_AUTH_ASKPASS="$TMPDIR/provider-auth-askpass.sh"
PROVIDER_AUTH_USER="auth-user"
PROVIDER_AUTH_PASS="auth-pass"
PROVIDER_AUTH_ROOT="https://$PROVIDER_AUTH_USER@127.0.0.1:1"
mkdir -p "$PROVIDER_AUTH_HOME/.skillspm" "$PROVIDER_AUTH_PROJECT"

cat > "$PROVIDER_AUTH_HELPER" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\${1:-}" >> "$PROVIDER_AUTH_HELPER_LOG"
cat > /dev/null
if [ "\${1:-}" = get ]; then
  printf 'username=%s\n' "$PROVIDER_AUTH_USER"
  printf 'password=%s\n' "$PROVIDER_AUTH_PASS"
fi
EOF
chmod +x "$PROVIDER_AUTH_HELPER"

cat > "$PROVIDER_AUTH_ASKPASS" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\${1:-}" >> "$PROVIDER_AUTH_ASKPASS_LOG"
case "\${1:-}" in
  Username*) printf '%s\n' "$PROVIDER_AUTH_USER" ;;
  Password*) printf '%s\n' "$PROVIDER_AUTH_PASS" ;;
  *) printf '\n' ;;
esac
EOF
chmod +x "$PROVIDER_AUTH_ASKPASS"

cat > "$PROVIDER_AUTH_PROJECT/skills.yaml" <<'YAML'
skills:
  - id: github:example/auth-required/skills/provider-demo
    version: 1.0.0
YAML
cat > "$PROVIDER_AUTH_HOME/.skillspm/library.yaml" <<YAML
schema: skills-library/v1
skills:
  "github:example/auth-required/skills/provider-demo":
    versions:
      1.0.0:
        path: $PROVIDER_AUTH_HOME/.skillspm/skills/github_example__auth-required__skills__provider-demo@1.0.0
        cached_at: "2026-03-16T00:00:00.000Z"
        source:
          kind: provider
          value: github:example/auth-required/skills/provider-demo
          provider:
            name: github
            ref: refs/tags/v1.0.0
            visibility: public
YAML

(
  cd "$PROVIDER_AUTH_PROJECT"
  set +e
  HOME="$PROVIDER_AUTH_HOME" \
  SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_AUTH_ROOT" \
  GIT_CONFIG_COUNT=2 \
  GIT_CONFIG_KEY_0=credential.helper \
  GIT_CONFIG_VALUE_0="!$PROVIDER_AUTH_HELPER" \
  GIT_CONFIG_KEY_1=core.askPass \
  GIT_CONFIG_VALUE_1="$PROVIDER_AUTH_ASKPASS" \
  GIT_ASKPASS="$PROVIDER_AUTH_ASKPASS" \
  "${CLI[@]}" install > "$TMPDIR/provider-auth.out" 2> "$TMPDIR/provider-auth.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "public github fetch failed for github:example/auth-required/skills/provider-demo" "$TMPDIR/provider-auth.err"
grep -Fq "Public github recovery only supports unauthenticated access to public GitHub repos" "$TMPDIR/provider-auth.err"
[ ! -d "$PROVIDER_AUTH_HOME/.skillspm/skills/github_example__auth-required__skills__provider-demo@1.0.0" ]
[ ! -s "$PROVIDER_AUTH_HELPER_LOG" ]
[ ! -s "$PROVIDER_AUTH_ASKPASS_LOG" ]

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
