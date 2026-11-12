#!/bin/bash

###############################################################################
# Install Git Hooks
#
# Purpose: Install security and audit hooks for the repository
# Usage: ./scripts/install-hooks.sh
###############################################################################

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_ROOT="$(cd "${REPO_ROOT}" && git rev-parse --show-toplevel 2>/dev/null || echo "${REPO_ROOT}")"
HOOKS_DIR="${GIT_ROOT}/.git/hooks"

echo "Installing git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p "${HOOKS_DIR}"

# Pre-push hook - run audit before push
cat > "${HOOKS_DIR}/pre-push" << 'HOOKEOF'
#!/bin/bash

# Pre-push hook: Run npm audit before pushing
set -e

BACKEND_DIR="$(git rev-parse --show-toplevel)/backend"

echo "🔒 Running npm audit before push..."

if [ -f "${BACKEND_DIR}/scripts/audit.sh" ]; then
  cd "${BACKEND_DIR}"
  bash scripts/audit.sh --level=critical || {
    echo ""
    echo "⚠️  Audit failed. Fix vulnerabilities before pushing:"
    echo "   npm audit fix"
    echo ""
    exit 1
  }
else
  echo "Audit script not found at ${BACKEND_DIR}/scripts/audit.sh"
  exit 1
fi
HOOKEOF

chmod +x "${HOOKS_DIR}/pre-push"

# Pre-commit hook - run audit for modified package files
cat > "${HOOKS_DIR}/pre-commit" << 'HOOKEOF'
#!/bin/bash

# Pre-commit hook: Run npm audit if package.json or package-lock.json changed
set -e

BACKEND_DIR="$(git rev-parse --show-toplevel)/backend"
PACKAGE_JSON="${BACKEND_DIR}/package.json"
PACKAGE_LOCK="${BACKEND_DIR}/package-lock.json"

# Check if either file is staged
if git diff --cached --name-only | grep -qE "(package\.json|package-lock\.json)"; then
  echo "📦 Dependency changes detected. Running npm audit..."

  if [ -f "${BACKEND_DIR}/scripts/audit.sh" ]; then
    cd "${BACKEND_DIR}"
    bash scripts/audit.sh --level=high || {
      echo ""
      echo "⚠️  Critical or high vulnerabilities found in dependencies."
      echo "   Run 'npm audit fix' to attempt automatic fixes."
      echo ""
      exit 1
    }
  fi
fi
HOOKEOF

chmod +x "${HOOKS_DIR}/pre-commit"

echo "✅ Git hooks installed successfully"
echo ""
echo "Installed hooks:"
echo "  - pre-push: Runs npm audit before pushing (critical level)"
echo "  - pre-commit: Runs npm audit if dependencies changed (high level)"
echo ""
echo "To bypass hooks in emergency:"
echo "  git push --no-verify"
echo "  git commit --no-verify"
