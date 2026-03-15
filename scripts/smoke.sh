#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node ${ROOT_DIR}/dist/cli.js"
TMP_DIR="$(mktemp -d)"
WORK_DIR="${TMP_DIR}/workspace"
HOME_DIR="${TMP_DIR}/home"

export HOME="${HOME_DIR}"

mkdir -p "${WORK_DIR}" "${HOME_DIR}"
cd "${WORK_DIR}"

${CLI} --help >/tmp/skillspm-help.log
grep -q "Public commands:" /tmp/skillspm-help.log
grep -q "add" /tmp/skillspm-help.log
grep -q "install" /tmp/skillspm-help.log
grep -q "pack" /tmp/skillspm-help.log
grep -q "freeze" /tmp/skillspm-help.log
grep -q "adopt" /tmp/skillspm-help.log
grep -q "sync" /tmp/skillspm-help.log
grep -q "doctor" /tmp/skillspm-help.log
grep -q "help" /tmp/skillspm-help.log
! grep -q "import" /tmp/skillspm-help.log
! grep -q "inspect" /tmp/skillspm-help.log
! grep -q "snapshot" /tmp/skillspm-help.log
! grep -q "bootstrap" /tmp/skillspm-help.log
! grep -q "target" /tmp/skillspm-help.log

set +e
${CLI} help import >/tmp/skillspm-help-import.log 2>&1
HELP_IMPORT_EXIT=$?
${CLI} help inspect >/tmp/skillspm-help-inspect.log 2>&1
HELP_INSPECT_EXIT=$?
${CLI} import >/tmp/skillspm-import.log 2>&1
IMPORT_EXIT=$?
${CLI} inspect ./local-skills >/tmp/skillspm-inspect.log 2>&1
INSPECT_EXIT=$?
set -e
test "${HELP_IMPORT_EXIT}" -eq 2
test "${HELP_INSPECT_EXIT}" -eq 2
test "${IMPORT_EXIT}" -eq 2
test "${INSPECT_EXIT}" -eq 2
grep -q "Unknown command import" /tmp/skillspm-help-import.log
grep -q "Unknown command inspect" /tmp/skillspm-help-inspect.log
grep -q "Unknown command import" /tmp/skillspm-import.log
grep -q "Unknown command inspect" /tmp/skillspm-inspect.log

mkdir -p local-skills/dep local-skills/app

cat > local-skills/dep/SKILL.md <<'EOF'
# dep
EOF

cat > local-skills/dep/skill.yaml <<'EOF'
schema: skill/v1
id: local/dep
name: Dep
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > local-skills/app/SKILL.md <<'EOF'
# app
EOF

cat > local-skills/app/skill.yaml <<'EOF'
schema: skill/v1
id: local/app
name: App
version: 1.2.0
package:
  type: dir
  entry: ./
dependencies:
  - id: local/dep
    version: ^1.0.0
EOF

${CLI} add ./local-skills/dep >/tmp/skillspm-add-dep.log
${CLI} add ./local-skills/app >/tmp/skillspm-add-app.log

grep -q "schema: skills/v2" skills.yaml
grep -q "id: local/dep" skills.yaml
grep -q "id: local/app" skills.yaml
! grep -q "^sources:" skills.yaml
! grep -q "^settings:" skills.yaml
! grep -q "^project:" skills.yaml

${CLI} install >/tmp/skillspm-install.log

test -f skills.lock
grep -q "schema: skills-lock/v2" skills.lock
grep -q "local/app: 1.2.0" skills.lock
grep -q "local/dep: 1.0.0" skills.lock
! grep -q "^resolved:" skills.lock
! test -e .skills

test -f "${HOME}/.skillspm/library.yaml"
test -d "${HOME}/.skillspm/skills/local__app@1.2.0"
test -d "${HOME}/.skillspm/skills/local__dep@1.0.0"
grep -q "schema: skills-library/v1" "${HOME}/.skillspm/library.yaml"
grep -q "local/app:" "${HOME}/.skillspm/library.yaml"

cat > skills.yaml <<'EOF'
schema: skills/v2
skills: []
targets:
  - type: generic
    path: ./agent-target
EOF

cat > skills.lock <<'EOF'
schema: skills-lock/v2
skills:
  local/app: 1.2.0
  local/dep: 1.0.0
EOF

mkdir -p agent-target/manual-dir
printf 'keep\n' > agent-target/manual.txt

${CLI} sync generic >/tmp/skillspm-sync.log
test -d agent-target/local__app@1.2.0
test -d agent-target/local__dep@1.0.0
test -d agent-target/manual-dir
grep -q "keep" agent-target/manual.txt

${CLI} doctor >/tmp/skillspm-doctor.log
grep -q "Result: healthy" /tmp/skillspm-doctor.log

cat > skills.yaml <<'EOF'
schema: skills/v2
skills:
  - id: local/dep
    path: ./local-skills/dep
  - id: local/app
    path: ./local-skills/app
targets:
  - type: generic
    path: ./agent-target
EOF

${CLI} install >/tmp/skillspm-install-again.log
${CLI} pack bundle >/tmp/skillspm-pack.log
test -f bundle.skillspm.tgz

PACK_WORK_DIR="${TMP_DIR}/pack-install"
mkdir -p "${PACK_WORK_DIR}"
cp bundle.skillspm.tgz "${PACK_WORK_DIR}/"
cd "${PACK_WORK_DIR}"

${CLI} install ./bundle.skillspm.tgz >/tmp/skillspm-pack-install.log
test -d "${HOME}/.skillspm/skills/local__app@1.2.0"
test -d "${HOME}/.skillspm/skills/local__dep@1.0.0"
! test -f skills.lock

cp bundle.skillspm.tgz another.skillspm.tgz
set +e
${CLI} install >/tmp/skillspm-multi-pack.log 2>&1
MULTI_PACK_EXIT=$?
set -e
test "${MULTI_PACK_EXIT}" -eq 2
grep -q "Multiple local \\*.skillspm.tgz files found" /tmp/skillspm-multi-pack.log

MANIFEST_PRECEDENCE_DIR="${TMP_DIR}/manifest-precedence"
mkdir -p "${MANIFEST_PRECEDENCE_DIR}/local-skills/one"
cd "${MANIFEST_PRECEDENCE_DIR}"

cat > local-skills/one/SKILL.md <<'EOF'
# one
EOF

cat > local-skills/one/skill.yaml <<'EOF'
schema: skill/v1
id: precedence/one
name: One
version: 0.1.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v2
skills:
  - id: precedence/one
    path: ./local-skills/one
EOF

cp "${PACK_WORK_DIR}/bundle.skillspm.tgz" ./bundle.skillspm.tgz
${CLI} install >/tmp/skillspm-manifest-precedence.log
grep -q "precedence/one: 0.1.0" skills.lock

INVALID_DIR="${TMP_DIR}/invalid-manifest"
mkdir -p "${INVALID_DIR}"
cd "${INVALID_DIR}"

cat > skills.yaml <<'EOF'
schema: skills/v2
sources: []
skills: []
EOF

set +e
${CLI} install >/tmp/skillspm-invalid-manifest.log 2>&1
INVALID_EXIT=$?
set -e
test "${INVALID_EXIT}" -eq 2
grep -q "unknown top-level key sources" /tmp/skillspm-invalid-manifest.log

EXTRA_MANIFEST_DIR="${TMP_DIR}/extra-manifest-key"
mkdir -p "${EXTRA_MANIFEST_DIR}"
cd "${EXTRA_MANIFEST_DIR}"

cat > skills.yaml <<'EOF'
schema: skills/v2
skills: []
extra: true
EOF

set +e
${CLI} install >/tmp/skillspm-extra-manifest.log 2>&1
EXTRA_MANIFEST_EXIT=$?
set -e
test "${EXTRA_MANIFEST_EXIT}" -eq 2
grep -q "unknown top-level key extra" /tmp/skillspm-extra-manifest.log

EXTRA_LOCK_DIR="${TMP_DIR}/extra-lock-key"
mkdir -p "${EXTRA_LOCK_DIR}/local-skills/dep"
cd "${EXTRA_LOCK_DIR}"

cat > local-skills/dep/SKILL.md <<'EOF'
# dep
EOF

cat > local-skills/dep/skill.yaml <<'EOF'
schema: skill/v1
id: local/dep
name: Dep
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

cat > skills.yaml <<'EOF'
schema: skills/v2
skills:
  - id: local/dep
    path: ./local-skills/dep
EOF

cat > skills.lock <<'EOF'
schema: skills-lock/v2
skills:
  local/dep: 1.0.0
extra: true
EOF

set +e
${CLI} install >/tmp/skillspm-extra-lock.log 2>&1
EXTRA_LOCK_EXIT=$?
set -e
test "${EXTRA_LOCK_EXIT}" -eq 2
grep -q "unknown top-level key extra" /tmp/skillspm-extra-lock.log

UNSAFE_SYNC_DIR="${TMP_DIR}/unsafe-sync"
OUTSIDE_TARGET="${TMP_DIR}/outside-target"
mkdir -p "${UNSAFE_SYNC_DIR}" "${OUTSIDE_TARGET}"
cd "${UNSAFE_SYNC_DIR}"

cat > skills.yaml <<'EOF'
schema: skills/v2
skills: []
targets:
  - type: generic
    path: ../outside-target
EOF

cat > skills.lock <<'EOF'
schema: skills-lock/v2
skills:
  local/app: 1.2.0
EOF

set +e
${CLI} sync generic >/tmp/skillspm-unsafe-sync.log 2>&1
UNSAFE_SYNC_EXIT=$?
set -e
test "${UNSAFE_SYNC_EXIT}" -eq 2
grep -q "resolves outside" /tmp/skillspm-unsafe-sync.log
! test -e "${OUTSIDE_TARGET}/local__app@1.2.0"

MANIFEST_ESCAPE_SRC="${TMP_DIR}/pack-manifest-escape-src"
mkdir -p "${MANIFEST_ESCAPE_SRC}/skills" "${MANIFEST_ESCAPE_SRC}/outside-skill"

cat > "${MANIFEST_ESCAPE_SRC}/manifest.yaml" <<'EOF'
schema: skills-pack-manifest/v1
generated_at: 2026-03-15T00:00:00.000Z
skills:
  local/escape:
    version: 1.0.0
    entry: ../outside-skill
EOF

cat > "${MANIFEST_ESCAPE_SRC}/skills.yaml" <<'EOF'
schema: skills/v2
skills:
  - id: local/escape
    version: 1.0.0
EOF

cat > "${MANIFEST_ESCAPE_SRC}/skills.lock" <<'EOF'
schema: skills-lock/v2
skills:
  local/escape: 1.0.0
EOF

cat > "${MANIFEST_ESCAPE_SRC}/outside-skill/SKILL.md" <<'EOF'
# escape
EOF

cat > "${MANIFEST_ESCAPE_SRC}/outside-skill/skill.yaml" <<'EOF'
schema: skill/v1
id: local/escape
name: Escape
version: 1.0.0
package:
  type: dir
  entry: ./
EOF

tar -czf "${TMP_DIR}/manifest-escape.skillspm.tgz" -C "${MANIFEST_ESCAPE_SRC}" .

PACK_SYMLINK_SRC="${TMP_DIR}/pack-symlink-escape-src"
PACK_SYMLINK_OUTSIDE="${TMP_DIR}/pack-symlink-outside"
mkdir -p "${PACK_SYMLINK_SRC}/skills" "${PACK_SYMLINK_OUTSIDE}"
ln -s "${PACK_SYMLINK_OUTSIDE}" "${PACK_SYMLINK_SRC}/skills/local__escape@1.0.0"

cat > "${PACK_SYMLINK_SRC}/manifest.yaml" <<'EOF'
schema: skills-pack-manifest/v1
generated_at: 2026-03-15T00:00:00.000Z
skills:
  local/escape:
    version: 1.0.0
    entry: local__escape@1.0.0
EOF

cat > "${PACK_SYMLINK_SRC}/skills.yaml" <<'EOF'
schema: skills/v2
skills:
  - id: local/escape
    version: 1.0.0
EOF

cat > "${PACK_SYMLINK_SRC}/skills.lock" <<'EOF'
schema: skills-lock/v2
skills:
  local/escape: 1.0.0
EOF

tar -czf "${TMP_DIR}/symlink-escape.skillspm.tgz" -C "${PACK_SYMLINK_SRC}" .

PACK_REJECT_DIR="${TMP_DIR}/pack-rejects"
mkdir -p "${PACK_REJECT_DIR}"
cd "${PACK_REJECT_DIR}"

set +e
${CLI} install "${TMP_DIR}/manifest-escape.skillspm.tgz" >/tmp/skillspm-pack-manifest-escape.log 2>&1
PACK_MANIFEST_ESCAPE_EXIT=$?
${CLI} install "${TMP_DIR}/symlink-escape.skillspm.tgz" >/tmp/skillspm-pack-symlink-escape.log 2>&1
PACK_SYMLINK_ESCAPE_EXIT=$?
set -e
test "${PACK_MANIFEST_ESCAPE_EXIT}" -eq 2
test "${PACK_SYMLINK_ESCAPE_EXIT}" -eq 2
grep -q "pack manifest entry for local/escape resolves outside" /tmp/skillspm-pack-manifest-escape.log
grep -q "pack payload entry local__escape@1.0.0 resolves outside" /tmp/skillspm-pack-symlink-escape.log
