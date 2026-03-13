#!/bin/sh

set -eu

PACKAGE_NAME='skillspm'
PACKAGE_VERSION="${SKILLSPM_VERSION:-latest}"
INSTALL_TARGET="$PACKAGE_NAME"

say() {
  printf '%s\n' "$*" >&2
}

if [ "$PACKAGE_VERSION" != "latest" ]; then
  INSTALL_TARGET="$PACKAGE_NAME@$PACKAGE_VERSION"
fi

if ! command -v node >/dev/null 2>&1; then
  say "Error: Node.js is required to install SkillsPM."
  say "Install Node.js 18 or newer, then run this script again."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  say "Error: SkillsPM requires Node.js 18 or newer."
  say "Current Node.js version: $(node -v 2>/dev/null || echo unknown)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  say "Error: npm is required to install SkillsPM."
  say "Install npm with your Node.js setup, then run this script again."
  exit 1
fi

say "Installing SkillsPM from npm: $INSTALL_TARGET"

if [ "${SKILLSPM_INSTALL_DRY_RUN:-0}" = "1" ]; then
  say "Dry run: npm install -g $INSTALL_TARGET"
  exit 0
fi

if ! npm install -g "$INSTALL_TARGET"; then
  say "Error: npm install failed."
  say "Check the output above, then try again."
  exit 1
fi

say "SkillsPM is installed. Run 'skillspm --help' to get started."
