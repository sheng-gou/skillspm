#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node ${ROOT_DIR}/dist/cli.js"
TMP_DIR="$(mktemp -d)"
WORK_DIR="${TMP_DIR}/workspace"
HOME_DIR="${TMP_DIR}/home"
EXAMPLE_SOURCE_AWARE_DIR="${ROOT_DIR}/examples/source-aware-live"
EXAMPLE_PACK_SOURCE_DIR="${ROOT_DIR}/examples/pack-transfer/source-workspace"
EXAMPLE_PACK_RESTORE_DIR="${ROOT_DIR}/examples/pack-transfer/restore-workspace"

export HOME="${HOME_DIR}"

cleanup_examples() {
  rm -rf \
    "${EXAMPLE_SOURCE_AWARE_DIR}/.skills" \
    "${EXAMPLE_SOURCE_AWARE_DIR}/skills.lock" \
    "${EXAMPLE_PACK_SOURCE_DIR}/.skills" \
    "${EXAMPLE_PACK_SOURCE_DIR}/skills.lock" \
    "${EXAMPLE_PACK_SOURCE_DIR}/packs" \
    "${EXAMPLE_PACK_RESTORE_DIR}/.skills" \
    "${EXAMPLE_PACK_RESTORE_DIR}/skills.lock" \
    "${EXAMPLE_PACK_RESTORE_DIR}/packs"
}

trap cleanup_examples EXIT

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

${CLI} init >/tmp/skills-init.log
${CLI} --help >/tmp/skills-help.log
grep -q "Usage: skillspm <command> \\[options\\]" /tmp/skills-help.log
grep -q "install           Resolve skills from local paths, declared sources, and configured exact-version pack restores" /tmp/skills-help.log
grep -q "pack              Write the installed exact skills into a portable directory pack" /tmp/skills-help.log
grep -q "doctor            Validate manifest, lockfile, installed skills, and targets" /tmp/skills-help.log
grep -q "bootstrap         Run install, auto-sync when enabled, then doctor" /tmp/skills-help.log

${CLI} install --help >/tmp/skills-help-install.log
grep -q "Resolve skills from local paths, declared sources, and configured exact-version pack restores" /tmp/skills-help-install.log

${CLI} pack --help >/tmp/skills-help-pack.log
grep -q "Write the installed exact skills into a portable directory pack" /tmp/skills-help-pack.log
grep -q "Write the directory pack to this path" /tmp/skills-help-pack.log

${CLI} doctor --help >/tmp/skills-help-doctor.log
grep -q "Validate manifest, lockfile, installed skills, and targets" /tmp/skills-help-doctor.log

${CLI} bootstrap --help >/tmp/skills-help-bootstrap.log
grep -q "Run install, auto-sync when enabled, then doctor" /tmp/skills-help-bootstrap.log

${CLI} add acme/plain >/tmp/skills-add-null.log
grep -q "acme/plain" skills.yaml
! grep -q "version: null" skills.yaml
! grep -q "source: null" skills.yaml

mkdir -p registry/dep registry/app local-skills/local-check

cat > registry/dep/SKILL.md <<'EOF'
# dep
EOF

cat > registry/dep/skill.yaml <<'EOF'
schema: skill/v1
id: acme/dep
name: Dependency Skill
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > registry/app/SKILL.md <<'EOF'
# app
EOF

cat > registry/app/skill.yaml <<'EOF'
schema: skill/v1
id: acme/app
name: App Skill
version: 1.0.0
package:
  type: dir
  entry: ./
dependencies:
  - id: acme/dep
    version: ^1.0.0
requires:
  binaries:
    - sh
EOF

cat > local-skills/local-check/SKILL.md <<'EOF'
# local
EOF

cat > local-skills/local-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/check
name: Local Check
version: 0.1.0
package:
  type: dir
  entry: ./
EOF

cat > index.yaml <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/app
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/app
  - id: acme/dep
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/dep
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: smoke
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/app
    version: ^1.0.0
    source: local
  - id: local/check
    path: ./local-skills/local-check
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-install.log

test -f skills.lock
test -d .skills/installed/acme__app@1.0.0
test -d .skills/installed/acme__dep@1.0.0
test -d .skills/installed/local__check@0.1.0

mkdir -p .skills/installed/stale@9.9.9
touch .skills/installed/keep.txt
${CLI} install >/tmp/skills-reinstall.log
! test -e .skills/installed/stale@9.9.9
test -f .skills/installed/keep.txt

${CLI} list >/tmp/skills-list.log
grep -q "acme/app" /tmp/skills-list.log
grep -q "local/check" /tmp/skills-list.log

${CLI} list --json >/tmp/skills-list.json
grep -q '"scope": "project"' /tmp/skills-list.json
grep -q '"view": "root"' /tmp/skills-list.json
grep -q '"version_range": "\^1.0.0"' /tmp/skills-list.json
grep -q '"path": "./local-skills/local-check"' /tmp/skills-list.json

${CLI} list --resolved >/tmp/skills-list-resolved.log
grep -q "acme/dep 1.0.0" /tmp/skills-list-resolved.log

${CLI} list --resolved --json >/tmp/skills-list-resolved.json
grep -q '"view": "resolved"' /tmp/skills-list-resolved.json
grep -q '"id": "acme/dep"' /tmp/skills-list-resolved.json
grep -q '"version": "1.0.0"' /tmp/skills-list-resolved.json

${CLI} snapshot >/tmp/skills-snapshot.log
grep -q "Skills snapshot (project)" /tmp/skills-snapshot.log
grep -q "Root skills (2)" /tmp/skills-snapshot.log
grep -q "Resolved skills (3)" /tmp/skills-snapshot.log
grep -q "Targets (1)" /tmp/skills-snapshot.log

${CLI} snapshot --json >/tmp/skills-snapshot.json
grep -q '"scope": "project"' /tmp/skills-snapshot.json
grep -q '"root_skills"' /tmp/skills-snapshot.json
grep -q '"resolved_skills"' /tmp/skills-snapshot.json
grep -q '"targets"' /tmp/skills-snapshot.json
grep -q '"generated_at"' /tmp/skills-snapshot.json

${CLI} snapshot --resolved --json >/tmp/skills-snapshot-resolved.json
grep -q '"resolution_source": "live"' /tmp/skills-snapshot-resolved.json
grep -q '"id": "acme/app"' /tmp/skills-snapshot-resolved.json

${CLI} why acme/dep >/tmp/skills-why.log
grep -q "acme/app -> acme/dep" /tmp/skills-why.log

${CLI} doctor >/tmp/skills-doctor.log
grep -q "Result: healthy" /tmp/skills-doctor.log

${CLI} doctor --json >/tmp/skills-doctor-healthy.json
grep -q '"result": "healthy"' /tmp/skills-doctor-healthy.json

cat > skills.yaml <<'EOF'
schema: skills/v1
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/app
    version: ^1.0.0
    source: local
  - id: local/check
    path: ./local-skills/local-check
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-install-no-project.log
${CLI} list --resolved >/tmp/skills-list-resolved-no-project.log
${CLI} snapshot >/tmp/skills-snapshot-no-project.log
${CLI} doctor >/tmp/skills-doctor-no-project.log
! grep -q '^project:' skills.lock
grep -q "Result: healthy" /tmp/skills-doctor-no-project.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project: {}
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/app
    version: ^1.0.0
    source: local
  - id: local/check
    path: ./local-skills/local-check
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-install-empty-project.log
${CLI} list --resolved >/tmp/skills-list-resolved-empty-project.log
${CLI} snapshot >/tmp/skills-snapshot-empty-project.log
${CLI} doctor >/tmp/skills-doctor-empty-project.log
grep -q '^project: {}$' skills.lock
grep -q "Result: healthy" /tmp/skills-doctor-empty-project.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: smoke
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/app
    version: ^1.0.0
    source: local
  - id: local/check
    path: ./local-skills/local-check
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

cat > skills.lock <<'EOF'
schema: skills-lock/v1
project: legacy-smoke
resolved:
  acme/app:
    version: 1.0.0
generated_at: 2026-03-11T00:00:00.000Z
EOF

${CLI} list --resolved >/tmp/skills-list-resolved-legacy-project.log
${CLI} snapshot >/tmp/skills-snapshot-legacy-project.log
${CLI} doctor >/tmp/skills-doctor-legacy-project.log
grep -q "acme/app 1.0.0" /tmp/skills-list-resolved-legacy-project.log
grep -q "Resolved skills (1)" /tmp/skills-snapshot-legacy-project.log
grep -q "Result: healthy" /tmp/skills-doctor-legacy-project.log
${CLI} freeze >/tmp/skills-freeze-legacy-project.log
grep -q '^project:$' skills.lock
grep -q '^  name: smoke$' skills.lock
! grep -q '^project: legacy-smoke$' skills.lock

cat > skills.lock <<'EOF'
schema: skills-lock/v1
resolved:
  acme/app:
    version: ../../..
generated_at: 2026-03-11T00:00:00.000Z
EOF

set +e
${CLI} doctor >/tmp/skills-bad-version-doctor.log 2>&1
BAD_VERSION_EXIT=$?
set -e
test "${BAD_VERSION_EXIT}" -ne 0
grep -q 'resolved.acme/app.version must be an exact semver or "unversioned"' /tmp/skills-bad-version-doctor.log

cat > skills.lock <<'EOF'
schema: nope
resolved: []
generated_at: 123
EOF

set +e
${CLI} list --resolved >/tmp/skills-bad-lock.log 2>&1
LOCK_EXIT=$?
set -e
test "${LOCK_EXIT}" -eq 2
grep -q "skills.lock is invalid" /tmp/skills-bad-lock.log

IMPORT_DIR="${TMP_DIR}/import-workspace"
mkdir -p "${IMPORT_DIR}" "${HOME}/.openclaw/skills" "${HOME}/.codex/skills" "${HOME}/.claude/skills"
cd "${IMPORT_DIR}"

${CLI} init >/tmp/skills-import-init.log

mkdir -p \
  local-skills/existing \
  local-skills/from-cwd \
  "${HOME}/.openclaw/skills/hosted-openclaw" \
  "${HOME}/.codex/skills/hosted-codex" \
  "${HOME}/.claude/skills/hosted-claude"

cat > local-skills/existing/SKILL.md <<'EOF'
# existing
EOF

cat > local-skills/existing/skill.yaml <<'EOF'
schema: skill/v1
id: local/existing
name: Existing Local Skill
version: 0.1.0
package:
  type: dir
  entry: ./
EOF

cat > local-skills/from-cwd/SKILL.md <<'EOF'
# from cwd
EOF

cat > local-skills/from-cwd/skill.yaml <<'EOF'
schema: skill/v1
id: local/from-cwd
name: Imported From Cwd
version: 0.2.0
package:
  type: dir
  entry: ./
EOF

cat > "${HOME}/.openclaw/skills/hosted-openclaw/SKILL.md" <<'EOF'
# openclaw
EOF

cat > "${HOME}/.openclaw/skills/hosted-openclaw/skill.yaml" <<'EOF'
schema: skill/v1
id: host/openclaw
name: Imported From OpenClaw
version: 1.2.3
package:
  type: dir
  entry: ./
EOF

cat > "${HOME}/.codex/skills/hosted-codex/SKILL.md" <<'EOF'
# codex
EOF

cat > "${HOME}/.codex/skills/hosted-codex/skill.yaml" <<'EOF'
schema: skill/v1
id: host/codex
name: Imported From Codex
version: 2.0.0
package:
  type: dir
  entry: ./
EOF

cat > "${HOME}/.claude/skills/hosted-claude/SKILL.md" <<'EOF'
# claude
EOF

cat > "${HOME}/.claude/skills/hosted-claude/skill.yaml" <<'EOF'
schema: skill/v1
id: host/claude-code
name: Imported From Claude Code
version: 3.0.0
package:
  type: dir
  entry: ./
EOF

${CLI} add ./local-skills/existing >/tmp/skills-import-add.log
${CLI} import >/tmp/skills-import.log

grep -q "Imported 2 skills" /tmp/skills-import.log
grep -q "local/existing" skills.yaml
grep -q "local/from-cwd" skills.yaml
grep -q "host/openclaw" skills.yaml
grep -q "path: ./local-skills/from-cwd" skills.yaml
grep -q "path: .skills/imported/host__openclaw" skills.yaml

${CLI} import --from codex >/tmp/skills-import-codex.log
grep -q "Imported 1 skill" /tmp/skills-import-codex.log
grep -q "host/codex" skills.yaml
grep -q "path: .skills/imported/host__codex" skills.yaml

${CLI} import --from claude_code >/tmp/skills-import-claude.log
grep -q "Imported 1 skill" /tmp/skills-import-claude.log
grep -q "host/claude-code" skills.yaml
grep -q "path: .skills/imported/host__claude-code" skills.yaml

${CLI} install >/tmp/skills-import-install.log
${CLI} sync >/tmp/skills-sync-openclaw.log
${CLI} sync codex --mode symlink >/tmp/skills-sync-codex.log

test -d "${HOME}/.openclaw/skills/local__existing@0.1.0"
test -d "${HOME}/.openclaw/skills/local__from-cwd@0.2.0"
test -d "${HOME}/.openclaw/skills/host__openclaw@1.2.3"
test -L "${HOME}/.codex/skills/local__existing@0.1.0"
grep -q "openclaw synced (copy)" /tmp/skills-sync-openclaw.log
grep -q "codex synced (symlink)" /tmp/skills-sync-codex.log

SYNC_CLEANUP_DIR="${TMP_DIR}/sync-cleanup-workspace"
mkdir -p \
  "${SYNC_CLEANUP_DIR}/local-skills/cleanup-check" \
  "${HOME}/.openclaw/skills" \
  "${HOME}/.codex/skills" \
  "${HOME}/.claude/skills"
cd "${SYNC_CLEANUP_DIR}"

${CLI} init >/tmp/skills-sync-cleanup-init.log

cat > local-skills/cleanup-check/SKILL.md <<'EOF'
# cleanup
EOF

cat > local-skills/cleanup-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/cleanup-check
name: Cleanup Check
version: 0.6.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: sync-cleanup
skills:
  - id: local/cleanup-check
    path: ./local-skills/cleanup-check
targets:
  - type: openclaw
  - type: codex
  - type: claude_code
  - type: generic
    path: ./generic-target
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-sync-cleanup-install.log

mkdir -p \
  "${HOME}/.openclaw/skills/stale-openclaw" \
  "${HOME}/.codex/skills/stale-codex" \
  "${HOME}/.claude/skills/stale-claude" \
  "${SYNC_CLEANUP_DIR}/generic-target/stale-generic"
touch \
  "${HOME}/.openclaw/skills/keep.txt" \
  "${HOME}/.codex/skills/keep.txt" \
  "${HOME}/.claude/skills/keep.txt" \
  "${SYNC_CLEANUP_DIR}/generic-target/keep.txt"

${CLI} sync >/tmp/skills-sync-cleanup.log

test -d "${HOME}/.openclaw/skills/local__cleanup-check@0.6.0"
test -d "${HOME}/.codex/skills/local__cleanup-check@0.6.0"
test -d "${HOME}/.claude/skills/local__cleanup-check@0.6.0"
test -d "${SYNC_CLEANUP_DIR}/generic-target/local__cleanup-check@0.6.0"
! test -e "${HOME}/.openclaw/skills/stale-openclaw"
! test -e "${HOME}/.codex/skills/stale-codex"
! test -e "${HOME}/.claude/skills/stale-claude"
! test -e "${SYNC_CLEANUP_DIR}/generic-target/stale-generic"
test -f "${HOME}/.openclaw/skills/keep.txt"
test -f "${HOME}/.codex/skills/keep.txt"
test -f "${HOME}/.claude/skills/keep.txt"
test -f "${SYNC_CLEANUP_DIR}/generic-target/keep.txt"
grep -q "openclaw synced (copy)" /tmp/skills-sync-cleanup.log
grep -q "codex synced (copy)" /tmp/skills-sync-cleanup.log
grep -q "claude_code synced (copy)" /tmp/skills-sync-cleanup.log
grep -q "generic synced (copy)" /tmp/skills-sync-cleanup.log

DEFAULT_SYNC_LINK_DIR="${TMP_DIR}/default-sync-link-workspace"
DEFAULT_SYNC_OPENCLAW_OUTSIDE="${TMP_DIR}/default-sync-openclaw-outside"
DEFAULT_SYNC_CODEX_OUTSIDE="${TMP_DIR}/default-sync-codex-outside"
DEFAULT_SYNC_CLAUDE_OUTSIDE="${TMP_DIR}/default-sync-claude-outside"
mkdir -p \
  "${DEFAULT_SYNC_LINK_DIR}/local-skills/default-sync-link-check" \
  "${DEFAULT_SYNC_OPENCLAW_OUTSIDE}" \
  "${DEFAULT_SYNC_CODEX_OUTSIDE}" \
  "${DEFAULT_SYNC_CLAUDE_OUTSIDE}" \
  "${HOME}/.openclaw" \
  "${HOME}/.codex" \
  "${HOME}/.claude"

cat > "${DEFAULT_SYNC_LINK_DIR}/local-skills/default-sync-link-check/SKILL.md" <<'EOF'
# default sync link
EOF

cat > "${DEFAULT_SYNC_LINK_DIR}/local-skills/default-sync-link-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/default-sync-link-check
name: Default Sync Link Check
version: 0.13.0
package:
  type: dir
  entry: ./
EOF

rm -rf "${HOME}/.openclaw/skills" "${HOME}/.codex/skills" "${HOME}/.claude/skills"
ln -s "${DEFAULT_SYNC_OPENCLAW_OUTSIDE}" "${HOME}/.openclaw/skills"
ln -s "${DEFAULT_SYNC_CODEX_OUTSIDE}" "${HOME}/.codex/skills"
ln -s "${DEFAULT_SYNC_CLAUDE_OUTSIDE}" "${HOME}/.claude/skills"

cd "${DEFAULT_SYNC_LINK_DIR}"
${CLI} init >/tmp/skills-default-sync-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: default-sync-link-check
skills:
  - id: local/default-sync-link-check
    path: ./local-skills/default-sync-link-check
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-default-sync-link-install.log

set +e
${CLI} sync >/tmp/skills-default-sync-openclaw.log 2>&1
DEFAULT_SYNC_OPENCLAW_EXIT=$?
set -e
test "${DEFAULT_SYNC_OPENCLAW_EXIT}" -eq 2
grep -q "cleanup root .*\\.openclaw/skills resolves outside" /tmp/skills-default-sync-openclaw.log
! test -e "${DEFAULT_SYNC_OPENCLAW_OUTSIDE}/local__default-sync-link-check@0.13.0"

set +e
${CLI} sync codex >/tmp/skills-default-sync-codex.log 2>&1
DEFAULT_SYNC_CODEX_EXIT=$?
set -e
test "${DEFAULT_SYNC_CODEX_EXIT}" -eq 2
grep -q "cleanup root .*\\.codex/skills resolves outside" /tmp/skills-default-sync-codex.log
! test -e "${DEFAULT_SYNC_CODEX_OUTSIDE}/local__default-sync-link-check@0.13.0"

set +e
${CLI} sync claude_code >/tmp/skills-default-sync-claude.log 2>&1
DEFAULT_SYNC_CLAUDE_EXIT=$?
set -e
test "${DEFAULT_SYNC_CLAUDE_EXIT}" -eq 2
grep -q "cleanup root .*\\.claude/skills resolves outside" /tmp/skills-default-sync-claude.log
! test -e "${DEFAULT_SYNC_CLAUDE_OUTSIDE}/local__default-sync-link-check@0.13.0"

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} sync >/tmp/skills-default-sync-openclaw-unsafe.log
SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} sync codex >/tmp/skills-default-sync-codex-unsafe.log
SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} sync claude_code >/tmp/skills-default-sync-claude-unsafe.log

test -d "${DEFAULT_SYNC_OPENCLAW_OUTSIDE}/local__default-sync-link-check@0.13.0"
test -d "${DEFAULT_SYNC_CODEX_OUTSIDE}/local__default-sync-link-check@0.13.0"
test -d "${DEFAULT_SYNC_CLAUDE_OUTSIDE}/local__default-sync-link-check@0.13.0"
grep -q "openclaw synced (copy)" /tmp/skills-default-sync-openclaw-unsafe.log
grep -q "codex synced (copy)" /tmp/skills-default-sync-codex-unsafe.log
grep -q "claude_code synced (copy)" /tmp/skills-default-sync-claude-unsafe.log

rm -rf "${HOME}/.openclaw/skills" "${HOME}/.codex/skills" "${HOME}/.claude/skills"
mkdir -p "${HOME}/.openclaw/skills" "${HOME}/.codex/skills" "${HOME}/.claude/skills"

AUTO_SYNC_DIR="${TMP_DIR}/auto-sync-workspace"
mkdir -p "${AUTO_SYNC_DIR}/local-skills/auto-sync-check"
cd "${AUTO_SYNC_DIR}"

${CLI} init >/tmp/skills-auto-sync-init.log

cat > local-skills/auto-sync-check/SKILL.md <<'EOF'
# auto sync
EOF

cat > local-skills/auto-sync-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/auto-sync-check
name: Auto Sync Check
version: 0.7.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: auto-sync
skills:
  - id: local/auto-sync-check
    path: ./local-skills/auto-sync-check
targets:
  - type: generic
    path: ./synced-target
settings:
  install_mode: copy
  auto_sync: true
  strict: false
EOF

${CLI} install >/tmp/skills-auto-sync-install.log
test -d .skills/installed/local__auto-sync-check@0.7.0
test -d ./synced-target/local__auto-sync-check@0.7.0
grep -q "generic synced (copy)" /tmp/skills-auto-sync-install.log

INVALID_GIT_SOURCE_DIR="${TMP_DIR}/git-source-validation-workspace"
mkdir -p "${INVALID_GIT_SOURCE_DIR}"
cd "${INVALID_GIT_SOURCE_DIR}"
${CLI} init >/tmp/skills-git-url-init.log

check_invalid_git_source_url() {
  local case_name="$1"
  local url="$2"
  local expected_detail="$3"

  cat > skills.yaml <<EOF
schema: skills/v1
project:
  name: git-source-validation
sources:
  - name: upstream
    type: git
    url: "${url}"
skills:
  - id: acme/git-app
    version: 1.1.0
    source: upstream
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

  set +e
  ${CLI} install >"/tmp/skills-git-url-${case_name}.log" 2>&1
  local exit_code=$?
  set -e

  test "${exit_code}" -eq 2
  grep -q "Phase 1 only supports public anonymous HTTPS git sources" "/tmp/skills-git-url-${case_name}.log"
  grep -q "${expected_detail}" "/tmp/skills-git-url-${case_name}.log"
}

check_invalid_git_source_url "file" "file://${TMP_DIR}/git-source-repo.git" "file:// URLs are not allowed"
check_invalid_git_source_url "ssh" "ssh://github.com/example/public-skills.git" "ssh:// URLs are not allowed"
check_invalid_git_source_url "scp" "git@github.com:example/public-skills.git" "SCP-like git@host:repo URLs are not allowed"
check_invalid_git_source_url "credentials" "https://token@github.com/example/public-skills.git" "embedded credentials are not allowed"
check_invalid_git_source_url "query" "https://github.com/example/public-skills.git?ref=main" "Query strings are not allowed in Phase 1"
check_invalid_git_source_url "fragment" "https://github.com/example/public-skills.git#main" "URL fragments are not allowed in Phase 1"

HTTPS_GIT_SOURCE_DIR="${TMP_DIR}/git-source-https-workspace"
mkdir -p "${HTTPS_GIT_SOURCE_DIR}"
cd "${HTTPS_GIT_SOURCE_DIR}"
${CLI} init >/tmp/skills-git-https-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: git-source-https
sources:
  - name: upstream
    type: git
    url: https://127.0.0.1/example/public-skills.git
skills:
  - id: acme/git-app
    version: 1.1.0
    source: upstream
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

set +e
${CLI} install >/tmp/skills-git-https-install.log 2>&1
HTTPS_EXIT=$?
set -e
test "${HTTPS_EXIT}" -eq 4
grep -q "Unable to clone git source upstream from https://127.0.0.1/example/public-skills.git" /tmp/skills-git-https-install.log
if grep -q "Phase 1 only supports public anonymous HTTPS git sources" /tmp/skills-git-https-install.log; then
  echo "unexpected Phase 1 git URL rejection for anonymous https:// source" >&2
  exit 1
fi

GIT_REWRITE_SOURCE_DIR="${TMP_DIR}/git-rewrite-source"
GIT_REWRITE_BARE_REPO="${TMP_DIR}/git-rewrite-source.git"
GIT_REWRITE_CONTROL_CLONE_DIR="${TMP_DIR}/git-rewrite-control-clone"
mkdir -p "${GIT_REWRITE_SOURCE_DIR}/skills/acme/git-app/1.1.0"

cat > "${GIT_REWRITE_SOURCE_DIR}/skills/acme/git-app/1.1.0/SKILL.md" <<'EOF'
# git app
EOF

cat > "${GIT_REWRITE_SOURCE_DIR}/skills/acme/git-app/1.1.0/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/git-app
name: Git App
version: 1.1.0
package:
  type: dir
  entry: ./
EOF

git -C "${GIT_REWRITE_SOURCE_DIR}" init >/tmp/skills-git-rewrite-init.log 2>&1
git -C "${GIT_REWRITE_SOURCE_DIR}" config user.name "Smoke Test"
git -C "${GIT_REWRITE_SOURCE_DIR}" config user.email "smoke@example.com"
git -C "${GIT_REWRITE_SOURCE_DIR}" add skills
git -C "${GIT_REWRITE_SOURCE_DIR}" commit -m "seed git source" >/tmp/skills-git-rewrite-commit.log 2>&1
git clone --bare "${GIT_REWRITE_SOURCE_DIR}" "${GIT_REWRITE_BARE_REPO}" >/tmp/skills-git-rewrite-bare.log 2>&1

cat > "${HOME}/.gitconfig" <<EOF
[url "file://${GIT_REWRITE_BARE_REPO}"]
  insteadOf = https://rewrite.example/acme/public-skills.git
EOF

rm -rf "${GIT_REWRITE_CONTROL_CLONE_DIR}"
git clone --depth 1 --no-tags https://rewrite.example/acme/public-skills.git "${GIT_REWRITE_CONTROL_CLONE_DIR}" \
  >/tmp/skills-git-rewrite-control.log 2>&1
test -f "${GIT_REWRITE_CONTROL_CLONE_DIR}/skills/acme/git-app/1.1.0/SKILL.md"

GIT_REWRITE_WORKSPACE_DIR="${TMP_DIR}/git-rewrite-workspace"
mkdir -p "${GIT_REWRITE_WORKSPACE_DIR}"
cd "${GIT_REWRITE_WORKSPACE_DIR}"
${CLI} init >/tmp/skills-git-rewrite-workspace-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: git-rewrite
sources:
  - name: upstream
    type: git
    url: https://rewrite.example/acme/public-skills.git
skills:
  - id: acme/git-app
    version: 1.1.0
    source: upstream
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

set +e
${CLI} install >/tmp/skills-git-rewrite-install.log 2>&1
GIT_REWRITE_EXIT=$?
set -e
test "${GIT_REWRITE_EXIT}" -eq 4
grep -q "Unable to clone git source upstream from https://rewrite.example/acme/public-skills.git" \
  /tmp/skills-git-rewrite-install.log
! test -d .skills/installed/acme__git-app@1.1.0

LOCAL_PACK_SOURCE_DIR="${TMP_DIR}/pack-source-workspace"
LOCAL_PACK_RESTORE_DIR="${TMP_DIR}/pack-restore-workspace"
mkdir -p "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-dep" "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-app" "${LOCAL_PACK_RESTORE_DIR}"

cat > "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-dep/SKILL.md" <<'EOF'
# packed dep
EOF

cat > "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-dep/skill.yaml" <<'EOF'
schema: skill/v1
id: local/packed-dep
name: Packed Dependency
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-app/SKILL.md" <<'EOF'
# packed app
EOF

cat > "${LOCAL_PACK_SOURCE_DIR}/local-skills/packed-app/skill.yaml" <<'EOF'
schema: skill/v1
id: local/packed-app
name: Packed App
version: 1.1.0
package:
  type: dir
  entry: ./
EOF

cd "${LOCAL_PACK_SOURCE_DIR}"
${CLI} init >/tmp/skills-pack-source-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: pack-source
skills:
  - id: local/packed-app
    path: ./local-skills/packed-app
  - id: local/packed-dep
    path: ./local-skills/packed-dep
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-pack-source-install.log
test -d .skills/installed/local__packed-app@1.1.0
test -d .skills/installed/local__packed-dep@1.0.0
grep -q 'materialization:' skills.lock
grep -q 'type: live' skills.lock

${CLI} pack --out ./packs/phase1 >/tmp/skills-pack.log
test -f ./packs/phase1/pack.yaml
test -d ./packs/phase1/skills/local__packed-app@1.1.0
test -d ./packs/phase1/skills/local__packed-dep@1.0.0
grep -q 'schema: skills-pack/v1' ./packs/phase1/pack.yaml
grep -q 'local/packed-app:' ./packs/phase1/pack.yaml
grep -q 'local/packed-dep:' ./packs/phase1/pack.yaml

cd "${LOCAL_PACK_RESTORE_DIR}"
${CLI} init >/tmp/skills-pack-restore-init.log
mkdir -p imported-pack
cp -R "${LOCAL_PACK_SOURCE_DIR}/packs/phase1/." imported-pack/

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: pack-restore
packs:
  - name: phase1
    path: ./imported-pack
skills:
  - id: local/packed-app
    version: 1.1.0
  - id: local/packed-dep
    version: 1.0.0
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-pack-restore-install.log
test -d .skills/installed/local__packed-app@1.1.0
test -d .skills/installed/local__packed-dep@1.0.0
grep -q 'pack: phase1' skills.lock
grep -q 'entry: skills/local__packed-app@1.1.0' skills.lock
grep -q 'entry: skills/local__packed-dep@1.0.0' skills.lock
grep -q 'type: pack' skills.lock
${CLI} list --resolved --json >/tmp/skills-pack-list-resolved.json
grep -q '"id": "local/packed-app"' /tmp/skills-pack-list-resolved.json
grep -q '"path": ".*imported-pack/skills/local__packed-app@1.1.0"' /tmp/skills-pack-list-resolved.json

PACK_SHADOW_PACK_SOURCE_DIR="${TMP_DIR}/pack-shadow-pack-source"
PACK_SHADOW_RESTORE_DIR="${TMP_DIR}/pack-shadow-restore-workspace"
mkdir -p "${PACK_SHADOW_PACK_SOURCE_DIR}/local-skills/shadowed" "${PACK_SHADOW_RESTORE_DIR}/registry/shadowed"

cat > "${PACK_SHADOW_PACK_SOURCE_DIR}/local-skills/shadowed/SKILL.md" <<'EOF'
# packed mismatch
EOF

cat > "${PACK_SHADOW_PACK_SOURCE_DIR}/local-skills/shadowed/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/shadowed
name: Shadowed Packed Skill
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cd "${PACK_SHADOW_PACK_SOURCE_DIR}"
${CLI} init >/tmp/skills-pack-shadow-pack-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: pack-shadow-pack
skills:
  - id: acme/shadowed
    path: ./local-skills/shadowed
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-pack-shadow-pack-install.log
${CLI} pack --out ./packs/shadow >/tmp/skills-pack-shadow-pack.log
test -f ./packs/shadow/pack.yaml

cat > "${PACK_SHADOW_RESTORE_DIR}/registry/shadowed/SKILL.md" <<'EOF'
# live manifest aligned
EOF

cat > "${PACK_SHADOW_RESTORE_DIR}/registry/shadowed/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/shadowed
name: Shadowed Live Skill
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > "${PACK_SHADOW_RESTORE_DIR}/index.yaml" <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/shadowed
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/shadowed
EOF

cd "${PACK_SHADOW_RESTORE_DIR}"
${CLI} init >/tmp/skills-pack-shadow-restore-init.log
mkdir -p imported-pack
cp -R "${PACK_SHADOW_PACK_SOURCE_DIR}/packs/shadow/." imported-pack/

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: pack-shadow-restore
sources:
  - name: upstream
    type: index
    url: ./index.yaml
packs:
  - name: shadow-pack
    path: ./imported-pack
skills:
  - id: acme/shadowed
    version: 1.0.0
    source: upstream
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-pack-shadow-restore-install.log
test -d .skills/installed/acme__shadowed@1.0.0
grep -q '# live manifest aligned' .skills/installed/acme__shadowed@1.0.0/SKILL.md
! grep -q '# packed mismatch' .skills/installed/acme__shadowed@1.0.0/SKILL.md
grep -q 'name: upstream' skills.lock
grep -q 'type: index' skills.lock
grep -q 'url: ./index.yaml' skills.lock
grep -q 'type: live' skills.lock
! grep -q 'pack: shadow-pack' skills.lock
${CLI} list --resolved --json >/tmp/skills-pack-shadow-list-resolved.json
grep -q '"id": "acme/shadowed"' /tmp/skills-pack-shadow-list-resolved.json
grep -q '"path": ".*registry/shadowed"' /tmp/skills-pack-shadow-list-resolved.json
! grep -q 'imported-pack/skills/acme__shadowed@1.0.0' /tmp/skills-pack-shadow-list-resolved.json

MARKER_DIR="${TMP_DIR}/marker-workspace"
mkdir -p "${MARKER_DIR}/local-skills/no-marker"
cd "${MARKER_DIR}"
${CLI} init >/tmp/skills-marker-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: marker-check
skills:
  - id: local/no-marker
    path: ./local-skills/no-marker
EOF

set +e
${CLI} install >/tmp/skills-marker-install.log 2>&1
MARKER_EXIT=$?
set -e
test "${MARKER_EXIT}" -eq 2
grep -q "must contain SKILL.md or skill.yaml" /tmp/skills-marker-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-marker-install-unsafe.log
test -d .skills/installed/local__no-marker@unversioned

OUTSIDE_DIR="${TMP_DIR}/outside-skill"
RELATIVE_ROOT="${TMP_DIR}/relative-root"
RELATIVE_DIR="${RELATIVE_ROOT}/outside"
RELATIVE_WORK_DIR="${RELATIVE_ROOT}/workspace"
ABS_DIR="${TMP_DIR}/absolute-workspace"
mkdir -p "${OUTSIDE_DIR}" "${RELATIVE_DIR}" "${RELATIVE_WORK_DIR}" "${ABS_DIR}"

cat > "${OUTSIDE_DIR}/SKILL.md" <<'EOF'
# outside
EOF

cat > "${OUTSIDE_DIR}/skill.yaml" <<'EOF'
schema: skill/v1
id: local/outside
name: Outside Skill
version: 0.3.0
package:
  type: dir
  entry: ./
EOF

cat > "${RELATIVE_DIR}/SKILL.md" <<'EOF'
# relative outside
EOF

cat > "${RELATIVE_DIR}/skill.yaml" <<'EOF'
schema: skill/v1
id: local/relative-outside
name: Relative Outside Skill
version: 0.4.0
package:
  type: dir
  entry: ./
EOF

cd "${RELATIVE_WORK_DIR}"
${CLI} init >/tmp/skills-relative-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: relative-check
skills:
  - id: local/relative-outside
    path: ../outside
EOF

set +e
${CLI} install >/tmp/skills-relative-install.log 2>&1
RELATIVE_EXIT=$?
set -e
test "${RELATIVE_EXIT}" -eq 2
grep -q "resolves outside" /tmp/skills-relative-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-relative-install-unsafe.log
test -d .skills/installed/local__relative-outside@0.4.0

cd "${ABS_DIR}"
${CLI} init >/tmp/skills-abs-init.log

cat > skills.yaml <<EOF
schema: skills/v1
project:
  name: abs-check
skills:
  - id: local/outside
    path: ${OUTSIDE_DIR}
EOF

set +e
${CLI} install >/tmp/skills-abs-install.log 2>&1
ABS_EXIT=$?
set -e
test "${ABS_EXIT}" -eq 2
grep -q "resolves outside" /tmp/skills-abs-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-abs-install-unsafe.log
test -d .skills/installed/local__outside@0.3.0

LOCAL_LINK_DIR="${TMP_DIR}/local-symlink-workspace"
LOCAL_LINK_OUTSIDE="${TMP_DIR}/local-symlink-outside"
mkdir -p "${LOCAL_LINK_DIR}" "${LOCAL_LINK_OUTSIDE}"

cat > "${LOCAL_LINK_OUTSIDE}/SKILL.md" <<'EOF'
# local symlink outside
EOF

cat > "${LOCAL_LINK_OUTSIDE}/skill.yaml" <<'EOF'
schema: skill/v1
id: local/symlink-outside
name: Local Symlink Outside
version: 0.5.0
package:
  type: dir
  entry: ./
EOF

ln -s "${LOCAL_LINK_OUTSIDE}" "${LOCAL_LINK_DIR}/linked-skill"

cd "${LOCAL_LINK_DIR}"
${CLI} init >/tmp/skills-local-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: local-link-check
skills:
  - id: local/symlink-outside
    path: ./linked-skill
EOF

set +e
${CLI} install >/tmp/skills-local-link-install.log 2>&1
LOCAL_LINK_EXIT=$?
set -e
test "${LOCAL_LINK_EXIT}" -eq 2
grep -q "resolves outside" /tmp/skills-local-link-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-local-link-install-unsafe.log
test -d .skills/installed/local__symlink-outside@0.5.0

INDEX_LINK_DIR="${TMP_DIR}/index-symlink-workspace"
INDEX_ARTIFACT_OUTSIDE="${TMP_DIR}/index-artifact-outside"
mkdir -p "${INDEX_LINK_DIR}/registry" "${INDEX_ARTIFACT_OUTSIDE}"

cat > "${INDEX_ARTIFACT_OUTSIDE}/SKILL.md" <<'EOF'
# index artifact outside
EOF

cat > "${INDEX_ARTIFACT_OUTSIDE}/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/symlink-artifact
name: Index Artifact Outside
version: 1.1.0
package:
  type: dir
  entry: ./
EOF

ln -s "${INDEX_ARTIFACT_OUTSIDE}" "${INDEX_LINK_DIR}/registry/linked-artifact"

cd "${INDEX_LINK_DIR}"
${CLI} init >/tmp/skills-index-link-init.log

cat > index.yaml <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/symlink-artifact
    versions:
      1.1.0:
        artifact:
          type: path
          url: ./registry/linked-artifact
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: index-link-check
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/symlink-artifact
    version: 1.1.0
    source: local
EOF

set +e
${CLI} install >/tmp/skills-index-link-install.log 2>&1
INDEX_LINK_EXIT=$?
set -e
test "${INDEX_LINK_EXIT}" -eq 2
grep -q "artifact path for acme/symlink-artifact@1.1.0 resolves outside" /tmp/skills-index-link-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-index-link-install-unsafe.log
test -d .skills/installed/acme__symlink-artifact@1.1.0

INDEX_METADATA_DIR="${TMP_DIR}/index-metadata-workspace"
INDEX_METADATA_OUTSIDE="${TMP_DIR}/index-metadata-outside"
mkdir -p "${INDEX_METADATA_DIR}/registry/meta-safe" "${INDEX_METADATA_OUTSIDE}"

cat > "${INDEX_METADATA_DIR}/registry/meta-safe/SKILL.md" <<'EOF'
# metadata symlink root
EOF

cat > "${INDEX_METADATA_OUTSIDE}/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/symlink-metadata
name: Index Metadata Outside
version: 2.0.0
package:
  type: dir
  entry: ./
EOF

ln -s "${INDEX_METADATA_OUTSIDE}/skill.yaml" "${INDEX_METADATA_DIR}/registry/meta-safe/linked-skill.yaml"

cd "${INDEX_METADATA_DIR}"
${CLI} init >/tmp/skills-index-metadata-init.log

cat > index.yaml <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/symlink-metadata
    versions:
      2.0.0:
        artifact:
          type: path
          url: ./registry/meta-safe
        metadata:
          path: ./linked-skill.yaml
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: index-metadata-check
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/symlink-metadata
    version: 2.0.0
    source: local
EOF

set +e
${CLI} install >/tmp/skills-index-metadata-install.log 2>&1
INDEX_METADATA_EXIT=$?
set -e
test "${INDEX_METADATA_EXIT}" -eq 2
grep -q "metadata path for acme/symlink-metadata@2.0.0 resolves outside" /tmp/skills-index-metadata-install.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-index-metadata-install-unsafe.log
test -d .skills/installed/acme__symlink-metadata@2.0.0

INSTALL_ROOT_LINK_DIR="${TMP_DIR}/install-root-link-workspace"
INSTALL_ROOT_LINK_OUTSIDE="${TMP_DIR}/install-root-link-outside"
mkdir -p "${INSTALL_ROOT_LINK_DIR}/local-skills/root-link-check" "${INSTALL_ROOT_LINK_OUTSIDE}"

cat > "${INSTALL_ROOT_LINK_DIR}/local-skills/root-link-check/SKILL.md" <<'EOF'
# install root link
EOF

cat > "${INSTALL_ROOT_LINK_DIR}/local-skills/root-link-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/root-link-check
name: Install Root Link Check
version: 0.9.0
package:
  type: dir
  entry: ./
EOF

cd "${INSTALL_ROOT_LINK_DIR}"
${CLI} init >/tmp/skills-install-root-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: install-root-link-check
skills:
  - id: local/root-link-check
    path: ./local-skills/root-link-check
EOF

ln -s "${INSTALL_ROOT_LINK_OUTSIDE}" .skills/installed

set +e
${CLI} install >/tmp/skills-install-root-link.log 2>&1
INSTALL_ROOT_LINK_EXIT=$?
set -e
test "${INSTALL_ROOT_LINK_EXIT}" -eq 2
grep -q "cleanup root .*\\.skills/installed resolves outside" /tmp/skills-install-root-link.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-install-root-link-unsafe.log
test -d "${INSTALL_ROOT_LINK_OUTSIDE}/local__root-link-check@0.9.0"

PROJECT_STATE_LINK_DIR="${TMP_DIR}/project-state-link-workspace"
PROJECT_STATE_LINK_OUTSIDE="${TMP_DIR}/project-state-link-outside"
mkdir -p "${PROJECT_STATE_LINK_DIR}/local-skills/project-state-link-check" "${PROJECT_STATE_LINK_OUTSIDE}"

cat > "${PROJECT_STATE_LINK_DIR}/local-skills/project-state-link-check/SKILL.md" <<'EOF'
# project state link
EOF

cat > "${PROJECT_STATE_LINK_DIR}/local-skills/project-state-link-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/project-state-link-check
name: Project State Link Check
version: 0.14.0
package:
  type: dir
  entry: ./
EOF

cd "${PROJECT_STATE_LINK_DIR}"
${CLI} init >/tmp/skills-project-state-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: project-state-link-check
skills:
  - id: local/project-state-link-check
    path: ./local-skills/project-state-link-check
EOF

rm -rf .skills
ln -s "${PROJECT_STATE_LINK_OUTSIDE}" .skills

set +e
${CLI} install >/tmp/skills-project-state-link-install.log 2>&1
PROJECT_STATE_LINK_EXIT=$?
set -e
test "${PROJECT_STATE_LINK_EXIT}" -eq 2
grep -q "cleanup root .*\\.skills/installed resolves outside" /tmp/skills-project-state-link-install.log
! test -e "${PROJECT_STATE_LINK_OUTSIDE}/installed"

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-project-state-link-install-unsafe.log
test -d "${PROJECT_STATE_LINK_OUTSIDE}/installed/local__project-state-link-check@0.14.0"

PROJECT_IMPORT_LINK_DIR="${TMP_DIR}/project-import-link-workspace"
PROJECT_IMPORT_LINK_OUTSIDE="${TMP_DIR}/project-import-link-outside"
PROJECT_IMPORT_SOURCE="${TMP_DIR}/project-import-link-source"
mkdir -p "${PROJECT_IMPORT_LINK_DIR}" "${PROJECT_IMPORT_LINK_OUTSIDE}/scan/external-import-check" "${PROJECT_IMPORT_SOURCE}"

cat > "${PROJECT_IMPORT_LINK_OUTSIDE}/scan/external-import-check/SKILL.md" <<'EOF'
# external import check
EOF

cat > "${PROJECT_IMPORT_LINK_OUTSIDE}/scan/external-import-check/skill.yaml" <<'EOF'
schema: skill/v1
id: external/import-check
name: External Import Check
version: 0.15.0
package:
  type: dir
  entry: ./
EOF

cd "${PROJECT_IMPORT_LINK_DIR}"
${CLI} init >/tmp/skills-project-import-link-init.log
rm -rf .skills
ln -s "${PROJECT_IMPORT_LINK_OUTSIDE}" .skills

set +e
${CLI} import --from "${PROJECT_IMPORT_LINK_OUTSIDE}/scan" >/tmp/skills-project-import-link.log 2>&1
PROJECT_IMPORT_LINK_EXIT=$?
set -e
test "${PROJECT_IMPORT_LINK_EXIT}" -eq 2
grep -q "imported skill vendor path .*\\.skills/imported/external__import-check resolves outside" /tmp/skills-project-import-link.log
! test -e "${PROJECT_IMPORT_LINK_OUTSIDE}/imported"

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} import --from "${PROJECT_IMPORT_LINK_OUTSIDE}/scan" >/tmp/skills-project-import-link-unsafe.log
grep -q "Imported 1 skill" /tmp/skills-project-import-link-unsafe.log
grep -q "path: .skills/imported/external__import-check" skills.yaml
test -d "${PROJECT_IMPORT_LINK_OUTSIDE}/imported/external__import-check"

SYNC_LINK_DIR="${TMP_DIR}/sync-target-link-workspace"
SYNC_LINK_OUTSIDE="${TMP_DIR}/sync-target-link-outside"
mkdir -p "${SYNC_LINK_DIR}/local-skills/sync-link-check" "${SYNC_LINK_OUTSIDE}"

cat > "${SYNC_LINK_DIR}/local-skills/sync-link-check/SKILL.md" <<'EOF'
# sync link
EOF

cat > "${SYNC_LINK_DIR}/local-skills/sync-link-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/sync-link-check
name: Sync Link Check
version: 0.10.0
package:
  type: dir
  entry: ./
EOF

ln -s "${SYNC_LINK_OUTSIDE}" "${SYNC_LINK_DIR}/linked-target"

cd "${SYNC_LINK_DIR}"
${CLI} init >/tmp/skills-sync-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: sync-target-link-check
skills:
  - id: local/sync-link-check
    path: ./local-skills/sync-link-check
targets:
  - type: generic
    path: ./linked-target
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-sync-link-install.log

set +e
${CLI} sync >/tmp/skills-sync-link.log 2>&1
SYNC_LINK_EXIT=$?
set -e
test "${SYNC_LINK_EXIT}" -eq 2
grep -q "cleanup root .*linked-target resolves outside" /tmp/skills-sync-link.log

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} sync >/tmp/skills-sync-link-unsafe.log
test -d "${SYNC_LINK_OUTSIDE}/local__sync-link-check@0.10.0"

SYNC_NESTED_LINK_DIR="${TMP_DIR}/sync-nested-target-workspace"
SYNC_NESTED_LINK_OUTSIDE="${TMP_DIR}/sync-nested-target-outside"
mkdir -p "${SYNC_NESTED_LINK_DIR}/local-skills/sync-nested-check" "${SYNC_NESTED_LINK_OUTSIDE}"

cat > "${SYNC_NESTED_LINK_DIR}/local-skills/sync-nested-check/SKILL.md" <<'EOF'
# sync nested link
EOF

cat > "${SYNC_NESTED_LINK_DIR}/local-skills/sync-nested-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/sync-nested-check
name: Sync Nested Check
version: 0.16.0
package:
  type: dir
  entry: ./
EOF

ln -s "${SYNC_NESTED_LINK_OUTSIDE}" "${SYNC_NESTED_LINK_DIR}/linked"

cd "${SYNC_NESTED_LINK_DIR}"
${CLI} init >/tmp/skills-sync-nested-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: sync-nested-target-check
skills:
  - id: local/sync-nested-check
    path: ./local-skills/sync-nested-check
targets:
  - type: generic
    path: ./linked/newdir
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-sync-nested-install.log

set +e
${CLI} sync >/tmp/skills-sync-nested.log 2>&1
SYNC_NESTED_EXIT=$?
set -e
test "${SYNC_NESTED_EXIT}" -eq 2
grep -q "cleanup root .*newdir resolves outside" /tmp/skills-sync-nested.log
! test -e "${SYNC_NESTED_LINK_OUTSIDE}/newdir"

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} sync >/tmp/skills-sync-nested-unsafe.log
test -d "${SYNC_NESTED_LINK_OUTSIDE}/newdir/local__sync-nested-check@0.16.0"

SOURCE_INDEX_LINK_DIR="${TMP_DIR}/source-index-link-workspace"
SOURCE_INDEX_LINK_OUTSIDE="${TMP_DIR}/source-index-link-outside"
mkdir -p "${SOURCE_INDEX_LINK_DIR}" "${SOURCE_INDEX_LINK_OUTSIDE}/registry/source-index-check"

cat > "${SOURCE_INDEX_LINK_OUTSIDE}/registry/source-index-check/SKILL.md" <<'EOF'
# source index link
EOF

cat > "${SOURCE_INDEX_LINK_OUTSIDE}/registry/source-index-check/skill.yaml" <<'EOF'
schema: skill/v1
id: acme/source-index-check
name: Source Index Check
version: 3.0.0
package:
  type: dir
  entry: ./
EOF

cat > "${SOURCE_INDEX_LINK_OUTSIDE}/index.yaml" <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/source-index-check
    versions:
      3.0.0:
        artifact:
          type: path
          url: ./registry/source-index-check
EOF

ln -s "${SOURCE_INDEX_LINK_OUTSIDE}/index.yaml" "${SOURCE_INDEX_LINK_DIR}/linked-index.yaml"

cd "${SOURCE_INDEX_LINK_DIR}"
${CLI} init >/tmp/skills-source-index-link-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: source-index-link-check
sources:
  - name: local
    type: index
    url: ./linked-index.yaml
skills:
  - id: acme/source-index-check
    version: 3.0.0
    source: local
EOF

set +e
${CLI} install >/tmp/skills-source-index-link-install.log 2>&1
SOURCE_INDEX_LINK_EXIT=$?
set -e
test "${SOURCE_INDEX_LINK_EXIT}" -eq 2
grep -q "source index ./linked-index.yaml resolves outside" /tmp/skills-source-index-link-install.log

ADD_LINK_DIR="${TMP_DIR}/add-link-workspace"
ADD_LINK_OUTSIDE="${TMP_DIR}/add-link-outside"
mkdir -p "${ADD_LINK_DIR}" "${ADD_LINK_OUTSIDE}"

cat > "${ADD_LINK_OUTSIDE}/SKILL.md" <<'EOF'
# add link
EOF

cat > "${ADD_LINK_OUTSIDE}/skill.yaml" <<'EOF'
schema: skill/v1
id: local/add-link-check
name: Add Link Check
version: 0.11.0
package:
  type: dir
  entry: ./
EOF

ln -s "${ADD_LINK_OUTSIDE}" "${ADD_LINK_DIR}/linked-add-skill"

cd "${ADD_LINK_DIR}"
${CLI} init >/tmp/skills-add-link-init.log

set +e
${CLI} add ./linked-add-skill >/tmp/skills-add-link.log 2>&1
ADD_LINK_EXIT=$?
set -e
test "${ADD_LINK_EXIT}" -eq 2
grep -q "local skill path ./linked-add-skill resolves outside" /tmp/skills-add-link.log

BOOTSTRAP_DIR="${TMP_DIR}/bootstrap-workspace"
mkdir -p "${BOOTSTRAP_DIR}/local-skills/bootstrap-check"
cd "${BOOTSTRAP_DIR}"

${CLI} init >/tmp/skills-bootstrap-init.log

cat > local-skills/bootstrap-check/SKILL.md <<'EOF'
# bootstrap
EOF

cat > local-skills/bootstrap-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/bootstrap-check
name: Bootstrap Check
version: 0.12.0
package:
  type: dir
  entry: ./
EOF

${CLI} add ./local-skills/bootstrap-check >/tmp/skills-bootstrap-add.log
${CLI} bootstrap >/tmp/skills-bootstrap.log

test -f skills.lock
test -d .skills/installed/local__bootstrap-check@0.12.0
grep -q "Result: healthy" /tmp/skills-bootstrap.log

TARGET_ADD_DIR="${TMP_DIR}/target-add-workspace"
mkdir -p "${TARGET_ADD_DIR}"
cd "${TARGET_ADD_DIR}"

${CLI} init >/tmp/skills-target-add-init.log
${CLI} target add codex >/tmp/skills-target-add.log
grep -q "type: codex" skills.yaml
${CLI} target add codex >/tmp/skills-target-add-noop.log
grep -q "already exists" /tmp/skills-target-add-noop.log
${CLI} target add generic --path ./generic-target >/tmp/skills-target-add-generic.log
grep -q "type: generic" skills.yaml
grep -q "path: ./generic-target" skills.yaml
${CLI} target --help >/tmp/skills-target-help.log
grep -q "generic" /tmp/skills-target-help.log
grep -q -- "--path <path>" /tmp/skills-target-help.log
${CLI} update --help >/tmp/skills-update-help.log
grep -q "Usage: skillspm update" /tmp/skills-update-help.log
grep -q -- "--to <version>" /tmp/skills-update-help.log

UPDATE_DIR="${TMP_DIR}/update-workspace"
mkdir -p "${UPDATE_DIR}/registry/update-check" "${UPDATE_DIR}/registry/stable-root"
cd "${UPDATE_DIR}"

${CLI} init >/tmp/skills-update-init.log

cat > registry/update-check/SKILL.md <<'EOF'
# update check
EOF

cat > registry/update-check/skill.yaml <<'EOF'
schema: skill/v1
id: acme/update-check
name: Update Check
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > registry/stable-root/SKILL.md <<'EOF'
# stable root
EOF

cat > registry/stable-root/skill.yaml <<'EOF'
schema: skill/v1
id: acme/stable-root
name: Stable Root
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > index.yaml <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/update-check
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/update-check
  - id: acme/stable-root
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/stable-root
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: update-workspace
sources:
  - name: local
    type: index
    url: ./index.yaml
skills:
  - id: acme/update-check
    version: ^1.0.0
    source: local
  - id: acme/stable-root
    version: ^1.0.0
    source: local
targets:
  - type: generic
    path: ./synced-target
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-update-install.log
grep -q "acme/update-check:" skills.lock
grep -A3 "acme/update-check:" skills.lock | grep -q "version: 1.0.0"
grep -q "acme/stable-root:" skills.lock
grep -A3 "acme/stable-root:" skills.lock | grep -q "version: 1.0.0"

cat > registry/update-check/skill.yaml <<'EOF'
schema: skill/v1
id: acme/update-check
name: Update Check
version: 1.1.0
package:
  type: dir
  entry: ./
EOF

cat > registry/stable-root/skill.yaml <<'EOF'
schema: skill/v1
id: acme/stable-root
name: Stable Root
version: 1.1.0
package:
  type: dir
  entry: ./
EOF

cat > index.yaml <<'EOF'
schema: skills-index/v1
skills:
  - id: acme/update-check
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/update-check
      1.1.0:
        artifact:
          type: path
          url: ./registry/update-check
  - id: acme/stable-root
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./registry/stable-root
      1.1.0:
        artifact:
          type: path
          url: ./registry/stable-root
EOF

${CLI} update acme/update-check >/tmp/skills-update-targeted.log
grep -q "Updated acme/update-check 1.0.0 -> 1.1.0" /tmp/skills-update-targeted.log
! grep -q "acme/stable-root 1.0.0 -> 1.1.0" /tmp/skills-update-targeted.log
grep -A3 "acme/update-check:" skills.lock | grep -q "version: 1.1.0"
grep -A3 "acme/stable-root:" skills.lock | grep -q "version: 1.0.0"

cp skills.yaml skills.before.failed-update.yaml
set +e
${CLI} update acme/update-check --to 9.9.9 >/tmp/skills-update-bad-pin.log 2>&1
UPDATE_BAD_PIN_EXIT=$?
set -e
test "${UPDATE_BAD_PIN_EXIT}" -ne 0
grep -q "Skill acme/update-check has no index version matching 9.9.9" /tmp/skills-update-bad-pin.log
cmp -s skills.before.failed-update.yaml skills.yaml

${CLI} update acme/update-check --to 1.0.0 >/tmp/skills-update-pin.log
grep -q "Pinned acme/update-check to 1.0.0" /tmp/skills-update-pin.log
grep -q "version: 1.0.0" skills.yaml
grep -A3 "acme/update-check:" skills.lock | grep -q "version: 1.0.0"
grep -A3 "acme/stable-root:" skills.lock | grep -q "version: 1.0.0"

UPDATE_GIT_DIR="${TMP_DIR}/update-git-workspace"
mkdir -p "${UPDATE_GIT_DIR}"
cd "${UPDATE_GIT_DIR}"

${CLI} init >/tmp/skills-update-git-init.log

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: update-git
sources:
  - name: upstream
    type: git
    url: https://example.com/acme/skills.git
skills:
  - id: acme/git-root
    version: ^1.0.0
    source: upstream
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

cp skills.yaml skills.before.yaml
set +e
${CLI} update acme/git-root --to 1.2.3 >/tmp/skills-update-git-pin.log 2>&1
UPDATE_GIT_EXIT=$?
set -e
test "${UPDATE_GIT_EXIT}" -eq 2
grep -q -- "--to is only supported for index-backed root skills" /tmp/skills-update-git-pin.log
! grep -q "git source install is not implemented yet" /tmp/skills-update-git-pin.log
grep -q "version: \^1.0.0" skills.yaml
cmp -s skills.before.yaml skills.yaml

cd "${UPDATE_DIR}"
${CLI} sync generic >/tmp/skills-update-sync.log
grep -q "status: synced" skills.lock
grep -q "last_synced_at:" skills.lock
grep -q "entry_count: 2" skills.lock
${CLI} snapshot --json >/tmp/skills-update-snapshot.json
grep -q '"status": "synced"' /tmp/skills-update-snapshot.json
grep -q '"entry_count": 2' /tmp/skills-update-snapshot.json

SNAPSHOT_PATH_DIR="${TMP_DIR}/snapshot-path-workspace"
mkdir -p "${SNAPSHOT_PATH_DIR}/local-skills/path-check"
cd "${SNAPSHOT_PATH_DIR}"

${CLI} init >/tmp/skills-snapshot-path-init.log

cat > local-skills/path-check/SKILL.md <<'EOF'
# path check
EOF

cat > local-skills/path-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/path-check
name: Path Check
version: 0.40.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: snapshot-path-check
skills:
  - id: local/path-check
    path: ./local-skills/path-check
targets:
  - type: generic
    path: ./target-a
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-snapshot-path-install.log
${CLI} sync >/tmp/skills-snapshot-path-sync.log

test -d "${SNAPSHOT_PATH_DIR}/target-a/local__path-check@0.40.0"

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: snapshot-path-check
skills:
  - id: local/path-check
    path: ./local-skills/path-check
targets:
  - type: generic
    path: ./target-b
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} freeze >/tmp/skills-snapshot-path-freeze.log
${CLI} snapshot --json >/tmp/skills-snapshot-path.json

SNAPSHOT_PATH_A="${SNAPSHOT_PATH_DIR}/target-a" SNAPSHOT_PATH_B="${SNAPSHOT_PATH_DIR}/target-b" node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync('/tmp/skills-snapshot-path.json', 'utf8'));
const genericTarget = snapshot.targets.find((target) => target.type === 'generic');
if (!genericTarget) {
  throw new Error('expected generic target record');
}
if (genericTarget.path !== process.env.SNAPSHOT_PATH_B) {
  throw new Error(`expected current path ${process.env.SNAPSHOT_PATH_B}, received ${genericTarget.path}`);
}
if (genericTarget.last_synced_path !== process.env.SNAPSHOT_PATH_A) {
  throw new Error(`expected last_synced_path ${process.env.SNAPSHOT_PATH_A}, received ${genericTarget.last_synced_path}`);
}
if (genericTarget.status !== 'synced') {
  throw new Error(`expected synced status, received ${genericTarget.status}`);
}
if (genericTarget.entry_count !== 1) {
  throw new Error(`expected entry_count 1, received ${genericTarget.entry_count}`);
}
EOF

grep -q 'path: .*target-a' skills.lock

grep -q '"last_synced_path": "' /tmp/skills-snapshot-path.json

DOCTOR_TARGET_DIR="${TMP_DIR}/doctor-target-workspace"
mkdir -p "${DOCTOR_TARGET_DIR}/local-skills/doctor-target"
cd "${DOCTOR_TARGET_DIR}"

${CLI} init >/tmp/skills-doctor-target-init.log

cat > local-skills/doctor-target/SKILL.md <<'EOF'
# doctor target
EOF

cat > local-skills/doctor-target/skill.yaml <<'EOF'
schema: skill/v1
id: local/doctor-target
name: Doctor Target
version: 0.30.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v1
project:
  name: doctor-target
skills:
  - id: local/doctor-target
    path: ./local-skills/doctor-target
targets:
  - type: generic
settings:
  install_mode: copy
  auto_sync: false
  strict: false
EOF

${CLI} install >/tmp/skills-doctor-target-install.log
${CLI} doctor --json >/tmp/skills-doctor-target.json
grep -q '"result": "warnings"' /tmp/skills-doctor-target.json
grep -q 'target generic requires an explicit path before sync can run' /tmp/skills-doctor-target.json

REMOVE_DIR="${TMP_DIR}/remove-workspace"
mkdir -p "${REMOVE_DIR}/local-skills/keep-skill" "${REMOVE_DIR}/local-skills/drop-skill"
cd "${REMOVE_DIR}"

${CLI} init >/tmp/skills-remove-init.log

cat > local-skills/keep-skill/SKILL.md <<'EOF'
# keep
EOF

cat > local-skills/keep-skill/skill.yaml <<'EOF'
schema: skill/v1
id: local/keep-skill
name: Keep Skill
version: 0.20.0
package:
  type: dir
  entry: ./
EOF

cat > local-skills/drop-skill/SKILL.md <<'EOF'
# drop
EOF

cat > local-skills/drop-skill/skill.yaml <<'EOF'
schema: skill/v1
id: local/drop-skill
name: Drop Skill
version: 0.21.0
package:
  type: dir
  entry: ./
EOF

${CLI} add ./local-skills/keep-skill >/tmp/skills-remove-add-keep.log
${CLI} add ./local-skills/drop-skill >/tmp/skills-remove-add-drop.log
${CLI} install >/tmp/skills-remove-install.log
test -d .skills/installed/local__drop-skill@0.21.0
${CLI} remove local/drop-skill >/tmp/skills-remove.log
! grep -q "local/drop-skill" skills.yaml
${CLI} bootstrap >/tmp/skills-remove-bootstrap.log
! test -e .skills/installed/local__drop-skill@0.21.0
test -d .skills/installed/local__keep-skill@0.20.0

FREEZE_DIR="${TMP_DIR}/freeze-workspace"
mkdir -p "${FREEZE_DIR}/local-skills/versioned-freeze" "${FREEZE_DIR}/local-skills/unversioned-freeze"
cd "${FREEZE_DIR}"

${CLI} init >/tmp/skills-freeze-init.log

cat > local-skills/versioned-freeze/SKILL.md <<'EOF'
# versioned freeze
EOF

cat > local-skills/versioned-freeze/skill.yaml <<'EOF'
schema: skill/v1
id: local/versioned-freeze
name: Versioned Freeze
version: 0.30.0
package:
  type: dir
  entry: ./
EOF

cat > local-skills/unversioned-freeze/SKILL.md <<'EOF'
# unversioned freeze
EOF

${CLI} add ./local-skills/versioned-freeze >/tmp/skills-freeze-add-versioned.log
${CLI} add ./local-skills/unversioned-freeze >/tmp/skills-freeze-add-unversioned.log
${CLI} install >/tmp/skills-freeze-install.log
rm -f skills.lock
${CLI} freeze >/tmp/skills-freeze.log
grep -q "Updated skills.lock from installed state" /tmp/skills-freeze.log
grep -q "local/versioned-freeze" skills.lock
grep -q "version: 0.30.0" skills.lock
grep -q "local/unversioned-freeze" skills.lock
grep -q "version: unversioned" skills.lock

FREEZE_LINK_DIR="${TMP_DIR}/freeze-link-workspace"
FREEZE_LINK_OUTSIDE="${TMP_DIR}/freeze-link-outside"
mkdir -p "${FREEZE_LINK_DIR}" "${FREEZE_LINK_OUTSIDE}/local__freeze-link-check@0.31.0"
cd "${FREEZE_LINK_DIR}"

${CLI} init >/tmp/skills-freeze-link-init.log

cat > "${FREEZE_LINK_OUTSIDE}/local__freeze-link-check@0.31.0/SKILL.md" <<'EOF'
# freeze link
EOF

cat > "${FREEZE_LINK_OUTSIDE}/local__freeze-link-check@0.31.0/skill.yaml" <<'EOF'
schema: skill/v1
id: local/freeze-link-check
name: Freeze Link Check
version: 0.31.0
package:
  type: dir
  entry: ./
EOF

ln -s "${FREEZE_LINK_OUTSIDE}" .skills/installed

set +e
${CLI} freeze >/tmp/skills-freeze-link.log 2>&1
FREEZE_LINK_EXIT=$?
set -e
test "${FREEZE_LINK_EXIT}" -eq 2
grep -q "cleanup root .*\\.skills/installed resolves outside" /tmp/skills-freeze-link.log
! test -e skills.lock

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} freeze >/tmp/skills-freeze-link-unsafe.log
grep -q "Updated skills.lock from installed state" /tmp/skills-freeze-link-unsafe.log
grep -q "local/freeze-link-check" skills.lock
grep -q "version: 0.31.0" skills.lock

INSPECT_DIR="${TMP_DIR}/inspect-workspace"
mkdir -p "${INSPECT_DIR}/skill-without-yaml" "${INSPECT_DIR}/skill-without-doc"
cd "${INSPECT_DIR}"

cat > skill-without-yaml/SKILL.md <<'EOF'
# inspect
EOF

${CLI} inspect ./skill-without-yaml --json >/tmp/skills-inspect.json
grep -q '"schema": {' /tmp/skills-inspect.json
grep -q '"category": "generated"' /tmp/skills-inspect.json
grep -q '"description": {' /tmp/skills-inspect.json
grep -q '"category": "missing"' /tmp/skills-inspect.json

${CLI} inspect ./skill-without-yaml --set-version 0.3.1 --write >/tmp/skills-inspect-write.log
grep -q '^id: skill-without-yaml$' skill-without-yaml/skill.yaml
grep -q '^version: 0.3.1$' skill-without-yaml/skill.yaml
grep -q '^dependencies: \[\]$' skill-without-yaml/skill.yaml

set +e
${CLI} inspect ./skill-without-doc --write >/tmp/skills-inspect-missing-doc.log 2>&1
INSPECT_MISSING_DOC_EXIT=$?
set -e
test "${INSPECT_MISSING_DOC_EXIT}" -eq 2
grep -q 'SKILL.md is required' /tmp/skills-inspect-missing-doc.log
! test -e skill-without-doc/skill.yaml

GLOBAL_SCOPE_DIR="${TMP_DIR}/global-scope-workspace"
mkdir -p "${GLOBAL_SCOPE_DIR}" "${HOME}/.skills/local-skills/global-check"
cd "${GLOBAL_SCOPE_DIR}"

cat > "${HOME}/.skills/local-skills/global-check/SKILL.md" <<'EOF'
# global
EOF

cat > "${HOME}/.skills/local-skills/global-check/skill.yaml" <<'EOF'
schema: skill/v1
id: local/global-check
name: Global Check
version: 0.8.1
package:
  type: dir
  entry: ./
EOF

${CLI} init -g >/tmp/skills-global-init.log
test -f "${HOME}/.skills/skills.yaml"
test -d "${HOME}/.skills/installed"
${CLI} add -g "${HOME}/.skills/local-skills/global-check" >/tmp/skills-global-add.log
${CLI} target add -g openclaw >/tmp/skills-global-target-openclaw.log
${CLI} target add -g codex >/tmp/skills-global-target-add.log
grep -q "type: openclaw" "${HOME}/.skills/skills.yaml"
grep -q "type: codex" "${HOME}/.skills/skills.yaml"
${CLI} install -g >/tmp/skills-global-install.log
${CLI} list -g --json >/tmp/skills-global-list.json
grep -q '"scope": "global"' /tmp/skills-global-list.json
${CLI} snapshot -g --json >/tmp/skills-global-snapshot.json
grep -q '"scope": "global"' /tmp/skills-global-snapshot.json
${CLI} sync -g >/tmp/skills-global-sync.log

test -f "${HOME}/.skills/skills.lock"
test -d "${HOME}/.skills/installed/local__global-check@0.8.1"
test -d "${HOME}/.openclaw/skills/local__global-check@0.8.1"
grep -q "openclaw synced (copy)" /tmp/skills-global-sync.log

if [ "${SKILLS_SKIP_PACKAGING_TEST:-0}" != "1" ]; then
  PACK_TMP="$(mktemp -d)"
  PACK_PREFIX="${PACK_TMP}/prefix"
  PACK_WORKSPACE="${PACK_TMP}/workspace"
  PACK_NAME="$(cd "${ROOT_DIR}" && npm pack --silent --ignore-scripts)"
  tar -xzf "${ROOT_DIR}/${PACK_NAME}" -C "${PACK_TMP}"
  test -f "${PACK_TMP}/package/node_modules/commander/package.json"
  test -f "${PACK_TMP}/package/node_modules/semver/package.json"
  test -f "${PACK_TMP}/package/node_modules/yaml/package.json"
  npm install -g --prefix "${PACK_PREFIX}" "${ROOT_DIR}/${PACK_NAME}" >/tmp/skills-packed-install.log
  "${PACK_PREFIX}/bin/skillspm" --help >/tmp/skills-packed-help.log
  grep -q "Usage: skillspm <command> \\[options\\]" /tmp/skills-packed-help.log

  mkdir -p "${PACK_WORKSPACE}/local-skills/packed-check"
  cd "${PACK_WORKSPACE}"
  "${PACK_PREFIX}/bin/skillspm" init >/tmp/skills-packed-init.log

  cat > local-skills/packed-check/SKILL.md <<'EOF'
# packed
EOF

  cat > local-skills/packed-check/skill.yaml <<'EOF'
schema: skill/v1
id: local/packed-check
name: Packed Check
version: 0.8.0
package:
  type: dir
  entry: ./
EOF

  "${PACK_PREFIX}/bin/skillspm" add ./local-skills/packed-check >/tmp/skills-packed-add.log
  "${PACK_PREFIX}/bin/skillspm" install >/tmp/skills-packed-chain-install.log

  test -f skills.lock
  test -d .skills/installed/local__packed-check@0.8.0
fi

cleanup_examples

cd "${EXAMPLE_SOURCE_AWARE_DIR}"
${CLI} install >/tmp/example-source-aware-install.log
${CLI} list --resolved >/tmp/example-source-aware-list.log
${CLI} doctor --json >/tmp/example-source-aware-doctor.json
test -d .skills/installed/demo__live-app@1.0.0
test -d .skills/installed/demo__helper@1.0.0
test -d .skills/installed/demo__local-note@0.1.0
grep -q "demo/live-app 1.0.0" /tmp/example-source-aware-list.log
grep -q "demo/local-note 0.1.0" /tmp/example-source-aware-list.log
grep -q '"result": "healthy"' /tmp/example-source-aware-doctor.json
grep -q 'type: index' skills.lock
grep -q 'type: path' skills.lock

cd "${EXAMPLE_PACK_SOURCE_DIR}"
${CLI} install >/tmp/example-pack-source-install.log
${CLI} pack --out ./packs/team-baseline >/tmp/example-pack-source-pack.log
test -f ./packs/team-baseline/pack.yaml
test -d ./packs/team-baseline/skills/demo__pack-app@1.0.0
test -d ./packs/team-baseline/skills/demo__pack-helper@1.0.0

cd "${EXAMPLE_PACK_RESTORE_DIR}"
mkdir -p ./packs
cp -R ../source-workspace/packs/team-baseline ./packs/team-baseline
${CLI} install >/tmp/example-pack-restore-install.log
${CLI} list --resolved >/tmp/example-pack-restore-list.log
${CLI} doctor --json >/tmp/example-pack-restore-doctor.json
test -d .skills/installed/demo__pack-app@1.0.0
test -d .skills/installed/demo__pack-helper@1.0.0
grep -q "demo/pack-helper 1.0.0" /tmp/example-pack-restore-list.log
grep -q '"result": "healthy"' /tmp/example-pack-restore-doctor.json
grep -q 'type: pack' skills.lock
grep -q 'pack: baseline' skills.lock
grep -q 'name: fixtures' skills.lock

echo "smoke ok"
