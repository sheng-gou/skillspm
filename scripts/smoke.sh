#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node ${ROOT_DIR}/dist/cli.js"
TMP_DIR="$(mktemp -d)"
WORK_DIR="${TMP_DIR}/workspace"
HOME_DIR="${TMP_DIR}/home"

export HOME="${HOME_DIR}"

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

${CLI} init >/tmp/skills-init.log
${CLI} --help >/tmp/skills-help.log
grep -q "Usage: skills <command> \\[options\\]" /tmp/skills-help.log

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

${CLI} list >/tmp/skills-list.log
grep -q "acme/app" /tmp/skills-list.log
grep -q "local/check" /tmp/skills-list.log

${CLI} list --resolved >/tmp/skills-list-resolved.log
grep -q "acme/dep 1.0.0" /tmp/skills-list-resolved.log

${CLI} why acme/dep >/tmp/skills-why.log
grep -q "acme/app -> acme/dep" /tmp/skills-why.log

${CLI} doctor >/tmp/skills-doctor.log
grep -q "Result: healthy" /tmp/skills-doctor.log

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
mkdir -p "${IMPORT_DIR}" "${HOME}/.openclaw/skills"
cd "${IMPORT_DIR}"

${CLI} init >/tmp/skills-import-init.log

mkdir -p local-skills/existing local-skills/from-cwd "${HOME}/.openclaw/skills/hosted-openclaw"

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

${CLI} add ./local-skills/existing >/tmp/skills-import-add.log
${CLI} import >/tmp/skills-import.log

grep -q "Imported 2 skills" /tmp/skills-import.log
grep -q "local/existing" skills.yaml
grep -q "local/from-cwd" skills.yaml
grep -q "host/openclaw" skills.yaml

SKILLS_ALLOW_UNSAFE_PATHS=1 ${CLI} install >/tmp/skills-import-install.log
${CLI} sync >/tmp/skills-sync-openclaw.log
${CLI} sync codex --mode symlink >/tmp/skills-sync-codex.log

test -d "${HOME}/.openclaw/skills/local__existing@0.1.0"
test -d "${HOME}/.openclaw/skills/local__from-cwd@0.2.0"
test -d "${HOME}/.openclaw/skills/host__openclaw@1.2.3"
test -L "${HOME}/.codex/skills/local__existing@0.1.0"
grep -q "openclaw synced (copy)" /tmp/skills-sync-openclaw.log
grep -q "codex synced (symlink)" /tmp/skills-sync-codex.log

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

if [ "${SKILLS_SKIP_PACKAGING_TEST:-0}" != "1" ]; then
  PACK_TMP="$(mktemp -d)"
  PACK_NAME="$(cd "${ROOT_DIR}" && npm pack --silent --ignore-scripts)"
  tar -xzf "${ROOT_DIR}/${PACK_NAME}" -C "${PACK_TMP}"
  test -f "${PACK_TMP}/package/node_modules/commander/package.json"
  test -f "${PACK_TMP}/package/node_modules/semver/package.json"
  test -f "${PACK_TMP}/package/node_modules/yaml/package.json"
  node "${PACK_TMP}/package/dist/bin/skills.js" --help >/tmp/skills-packed-help.log
  grep -q "Usage: skills <command> \\[options\\]" /tmp/skills-packed-help.log
fi

echo "smoke ok"
