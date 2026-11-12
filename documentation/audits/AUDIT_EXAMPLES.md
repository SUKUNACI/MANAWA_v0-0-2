# npm Audit - Practical Examples

Real-world examples of handling vulnerabilities with npm audit.

## Example 1: Critical Vulnerability Found

### Scenario

You push code and GitHub Actions blocks your PR:

```
🚨 CRITICAL: 1 critical vulnerabilities found
```

### Step-by-Step Fix

#### 1. Identify the Vulnerable Package

```bash
cd backend
npm audit
```

Output:
```
found 1 critical vulnerability in 250 packages
│ Critical  │ Prototype Pollution in lodash    │
│ Package   │ lodash                            │
│ Patched   │ >= 4.17.21                        │
│ Dependency of │ express via lodash            │
```

#### 2. Update the Package

```bash
# Update to patched version
npm update lodash

# Or install specific version
npm install lodash@4.17.21
```

#### 3. Verify the Fix

```bash
npm audit

# Should show:
# up to date, audited 250 packages
# 0 vulnerabilities
```

#### 4. Test Everything

```bash
npm test
npm run test:e2e
```

#### 5. Commit and Push

```bash
git add package.json package-lock.json
git commit -m "fix: update lodash to resolve critical vulnerability CVE-2021-23337"
git push
```

#### 6. PR Will Now Pass

GitHub Actions will show:
```
✅ Audit passed - No blocking vulnerabilities found
```

---

## Example 2: High Vulnerability in Transitive Dependency

### Scenario

Your `package.json` has `express@4.19.2`, which depends on `body-parser@1.20.x`, which has a high vulnerability.

```bash
npm audit
```

Output:
```
HIGH │ Denial of Service in body-parser    │
│ Vulnerable through │ express → body-parser │
│ Patched in │ > 1.20.2                  │
```

### Solution

#### Option A: Update Parent Package (Recommended)

```bash
# Update express to version with fixed dependencies
npm update express

# Verify fix
npm audit
```

#### Option B: Force Update of Transitive Dependency

```bash
# Install fixed version directly
npm install body-parser@1.20.3

# Or update package.json manually and reinstall
npm install
npm audit
```

#### Option C: Use resolutions (package.json)

```json
{
  "dependencies": {
    "express": "^4.19.2"
  },
  "resolutions": {
    "body-parser": "1.20.3"
  }
}
```

Then:
```bash
npm install
npm audit
```

---

## Example 3: Moderate Vulnerabilities - Can Fix Later

### Scenario

You have moderate vulnerabilities that aren't blocking:

```bash
npm audit

# Output:
# 3 moderate vulnerabilities found
```

### Decision: Fix Now or Later?

#### If You Have Time - Fix Now

```bash
npm audit fix

npm test

git add package.json package-lock.json
git commit -m "chore: fix moderate vulnerabilities"
git push
```

#### If You're In a Hurry - Plan Fix Later

1. Create an issue:
```bash
git issue create --title "Fix moderate vulnerabilities in dependencies"
```

2. Document in code:
```javascript
// TODO: Update [package-name] to v[X.Y.Z] to fix CVE-XXXX-XXXXX
// See: npm audit
// Timeline: Next maintenance window
```

3. Add to backlog with reminder

---

## Example 4: Multiple Vulnerabilities - Batch Fix

### Scenario

You find 5 vulnerabilities across different packages:

```bash
npm audit
```

### Automatic Fix (Quickest)

```bash
# Let npm automatically fix what it can
npm audit fix

# Check results
npm audit

# Test
npm test

# Commit
git add package.json package-lock.json
git commit -m "fix: resolve multiple vulnerabilities with npm audit fix"
```

### Manual Fix (When Auto Fails)

```bash
# Get JSON output for analysis
npm audit --json > audit.json

# Review each vulnerability manually
# Update packages one by one

npm update package1
npm update package2

# Test after each batch
npm test

# Once all fixed
npm audit

# Commit
git add package.json package-lock.json
git commit -m "fix: manually update multiple packages for security"
```

---

## Example 5: Exception - Can't Fix Now

### Scenario

You have a vulnerability but:
- It's in a package you're replacing in v2.0
- The fix breaks your app
- You need time to assess

### Create Exception

#### 1. Document in audit-config.json

```json
{
  "exceptions": [
    {
      "id": "CVE-2024-50280",
      "package": "deprecated-lib",
      "severity": "high",
      "reason": "This package is being replaced in MANAWA v2.0 (Timeline: Q2 2025). Vulnerability only affects feature X which uses alternative in v2.0.",
      "expiresAt": "2025-06-30T23:59:59Z",
      "approvedBy": "security-team",
      "jira": "SEC-1234",
      "notes": "See meeting notes: https://internal.example.com/meeting-123"
    }
  ]
}
```

#### 2. Submit PR with Exception

```bash
git add backend/audit-config.json
git commit -m "docs: document exception for deprecated-lib - replaced in v2.0"
git push

# Create PR with justification
# Link to security team approval
```

#### 3. Get Security Team Sign-Off

- Add to PR description:
```
Security Exception Request

Package: deprecated-lib
CVE: CVE-2024-50280
Severity: High
Timeline: Will be removed in v2.0 (Q2 2025)

Impact Assessment: 
- Only affects feature X
- Alternative implementation already in v2.0
- Low operational risk due to X mitigation

Approval Needed From: @security-team
```

#### 4. Monitor Exception

Before expiration date:
```bash
# Either fix it
npm update deprecated-lib
git add package.json package-lock.json
git commit -m "fix: remove deprecated-lib exception"

# Or extend (with new approval)
# Update expiresAt in audit-config.json
```

---

## Example 6: Check Current Status

### Quick Status Check

```bash
# Summary
npm audit

# Detailed JSON
npm audit --json

# By severity
npm audit --audit-level=critical
npm audit --audit-level=high
npm audit --audit-level=moderate
```

### Parse Results

```bash
# Get just counts
npm audit --json | jq '.metadata.vulnerabilities'

# Get vulnerable packages
npm audit --json | jq '.vulnerabilities | keys'

# Get specific severity
npm audit --json | jq '.vulnerabilities[] | select(.severity == "critical")'
```

---

## Example 7: Before Pushing Code

### Pre-Push Checklist

```bash
# 1. Run full audit
npm run audit

# 2. If failures found, fix
npm audit fix

# 3. Run tests to ensure nothing broke
npm test
npm run test:e2e

# 4. Verify fix worked
npm audit

# 5. Commit and push
git add package.json package-lock.json
git commit -m "chore: update dependencies and fix vulnerabilities"
git push
```

### In CI/CD

If pre-push hook blocks push:

```bash
# Check what's wrong
npm audit --audit-level=critical

# If nothing critical:
git push --no-verify  # Only in emergency!

# Then fix in follow-up PR:
npm audit fix
npm test
git add package.json package-lock.json
git commit -m "fix: resolve vulnerabilities"
git push
```

---

## Example 8: Local Development Setup

### First Time Setup

```bash
cd backend

# 1. Install hooks
bash scripts/install-hooks.sh

# 2. Run initial audit
npm run audit

# 3. Fix any issues
npm audit fix
npm test

# 4. Good to go!
```

### Daily Development

```bash
# Make your changes
# Write code
# Commit normally (hook runs automatically)

git add .
git commit -m "feat: add new feature"
# Hook runs: pre-commit
# If dependencies changed, audit runs

# Push code (hook runs automatically)
git push
# Hook runs: pre-push
# If critical vulnerabilities, push blocked
```

---

## Example 9: Update Single Package

### Scenario

You want to update React from 18.2.0 to 18.3.0

```bash
# Before
npm list react
# react@18.2.0

# Update
npm update react

# Verify
npm list react
# react@18.3.0

# Run audit
npm audit

# Test
npm test

# If all good, commit
git add package-lock.json
git commit -m "chore: update react to 18.3.0"
```

---

## Example 10: Emergency - Can't Fix Immediately

### Scenario

Critical vulnerability found, but:
- Fix requires major refactoring
- Team is on vacation
- Release is tomorrow

### Temporary Fix

```bash
# 1. Assess risk in current deployment
# - Is it exploitable in your use case?
# - Who can access this code?
# - What's the blast radius?

# 2. Document exception temporarily
cat >> backend/audit-config.json << 'EOF'
{
  "exceptions": [
    {
      "id": "TEMP-CRITICAL-2024",
      "package": "vulnerable-package",
      "severity": "critical",
      "reason": "TEMPORARY: Team on vacation. Will fix 2024-11-15.",
      "expiresAt": "2024-11-15T09:00:00Z",
      "approvedBy": "cto",
      "jira": "INFRA-9999"
    }
  ]
}
EOF

# 3. Add to PR for visibility
git add backend/audit-config.json
git commit -m "temp: document critical vulnerability exception (expires 2024-11-15)"

# 4. Set calendar reminder
# - Fix on 2024-11-15
# - Notify security team

# 5. Fix properly after return
npm update vulnerable-package
npm test
git add package.json package-lock.json
git commit -m "fix: resolve critical vulnerability - temporary exception removed"
```

---

## Quick Reference

### Commands

```bash
npm audit                           # Show vulnerabilities
npm audit --json                    # JSON output
npm audit --audit-level=critical    # Only critical
npm audit fix                       # Auto-fix
npm run audit                       # Using npm script
npm run audit:fix                   # Fix and report
npm run audit:html                  # Generate HTML report
bash scripts/audit.sh --level=high  # Custom options
```

### Exit Codes

```
0   = No vulnerabilities
1   = Critical or high found
```

### Report Locations

```
backend/audit-reports/audit-YYYY-MM-DD_HH-MM-SS.json   # JSON
backend/audit-reports/audit-YYYY-MM-DD_HH-MM-SS.html   # HTML
backend/audit-reports/audit-latest.json                 # Latest
```

### Configuration

```
backend/audit-config.json      # Settings
.github/workflows/audit.yml    # GitHub Actions
backend/scripts/audit.sh       # Main script
backend/scripts/install-hooks.sh # Git hooks
```
