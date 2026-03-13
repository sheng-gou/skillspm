#!/bin/sh

set -eu

INSTALL_TARGET='git+https://github.com/sheng-gou/skills-cli.git#main'

say() {
  printf '%s\n' "$*" >&2
}

if ! command -v node >/dev/null 2>&1; then
  say "Error: Node.js is required to install skills."
  say "Install Node.js 18 or newer, then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  say "Error: npm is required to install skills."
  say "Install npm with your Node.js setup, then run this script again."
  exit 1
fi

say "Installing skills with npm from this GitHub repository..."

if [ "${SKILLS_INSTALL_DRY_RUN:-0}" = "1" ]; then
  say "Dry run: npm install -g $INSTALL_TARGET"
  exit 0
fi

if ! npm install -g "$INSTALL_TARGET"; then
  say "Error: npm install failed."
  say "Check the output above, then try again."
  exit 1
fi

say "skills is installed. Run 'skills --help' to get started."
