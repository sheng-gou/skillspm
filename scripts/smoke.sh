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
  "${CLI[@]}" freeze
)
assert_node "const [library] = docs; const entry = library.skills['local/example'].versions['1.2.3']; return entry.path.endsWith('/local__example@1.2.3') && entry.source.kind === 'local' && entry.source.value.endsWith('/local-skill');" "$HOME/.skillspm/library.yaml"
[ -f "$LOCAL_INSTALL_PROJECT/skills.lock" ]
assert_node "const [lockfile] = docs; const entry = lockfile.skills['local/example']; return lockfile.schema === 'skills-lock/v3' && entry.version === '1.2.3' && /^sha256:[0-9a-f]{64}$/.test(entry.digest) && entry.resolved_from.type === 'local' && entry.resolved_from.ref.endsWith('/local-skill');" "$LOCAL_INSTALL_PROJECT/skills.lock"
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
  "${CLI[@]}" freeze
  "${CLI[@]}" sync openclaw,codex
)

assert_node "const [manifest] = docs; const keys = Object.keys(manifest).sort().join(','); if (keys !== 'skills') return false; if (manifest.skills.some((entry) => 'path' in entry)) return false; const ids = manifest.skills.map((entry) => entry.id + '@' + entry.version); return ids.includes('adopted/codex@3.1.0') && ids.includes('adopted/openclaw@2.0.0');" "$ADOPT_PROJECT/skills.yaml"
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

PROVIDER_FAIL_HOME="$TMPDIR/provider-fail-home"
PROVIDER_FIXTURE_ROOT="$TMPDIR/provider-github"
PROVIDER_WORKTREE="$TMPDIR/provider-worktree"
PROVIDER_REFRESH_PROJECT="$TMPDIR/provider-refresh-project"
mkdir -p "$PROVIDER_FAIL_HOME/.skillspm" "$PROVIDER_FIXTURE_ROOT/example" "$PROVIDER_WORKTREE" "$PROVIDER_REFRESH_PROJECT"

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
  set +e
  HOME="$PROVIDER_INSUFFICIENT_HOME" SKILLSPM_TEST_GITHUB_ROOT="$PROVIDER_FIXTURE_ROOT" "${CLI[@]}" install > "$TMPDIR/provider-insufficient.out" 2> "$TMPDIR/provider-insufficient.err"
  status=$?
  set -e
  test "$status" -ne 0
)
grep -Fq "recorded provider source is insufficient for re-materialization" "$TMPDIR/provider-insufficient.err"
[ ! -d "$PROVIDER_INSUFFICIENT_HOME/.skillspm/skills/github_example__public-skill__skills__provider-demo@2.0.0" ]

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
grep -Fq "Direct provider recovery only supports unauthenticated access to public GitHub repos" "$TMPDIR/provider-auth.err"
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
