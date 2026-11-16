# Security Scanning - npm Audit Integration

## Overview

This document describes the npm audit integration in the MANAWA backend CI/CD pipeline. The system automatically scans dependencies for known vulnerabilities and prevents merging of code with critical or high-severity security issues.

## How It Works

### Automated Scanning Triggers

1. **On Every Push to main/develop**
   - Triggered when `package.json` or `package-lock.json` changes
   - Automatically runs as GitHub Actions workflow
   - Results visible in PR checks

2. **Scheduled Scans**
   - Daily: 2:00 AM UTC
   - Weekly: Monday 3:00 AM UTC
   - Ensures ongoing vulnerability monitoring

3. **On Pull Requests**
   - Runs automatically for every PR
   - Posts detailed results as PR comment
   - Blocks merge if vulnerabilities found

4. **Local Development**
   - Run before commit: `npm run audit`
   - Run before push: `npm run audit:fix`
   - Manual check: `bash scripts/audit.sh`

## Usage

### Quick Commands

```bash
# Run audit with default settings (high severity level)
npm run audit

# Attempt to fix vulnerabilities automatically
npm run audit:fix

# Generate HTML report
npm run audit:html

# Check only critical vulnerabilities
npm run audit:critical

# Custom options
bash scripts/audit.sh --level=moderate --html --json
```

### Audit Script Options

```bash
Usage: ./scripts/audit.sh [--fix] [--level=<level>] [--html] [--json]

Options:
  --fix           Attempt to fix vulnerabilities automatically
  --level=<level> Audit level: low, moderate, high, critical (default: high)
  --html          Generate HTML report (see audit-reports/)
  --json          Generate JSON report (default)
```

### Reports Location

All audit reports are saved to `backend/audit-reports/`:

- `audit-YYYY-MM-DD_HH-MM-SS.json` - Detailed JSON report
- `audit-YYYY-MM-DD_HH-MM-SS.html` - Visual HTML report
- `audit-latest.json` - Symlink to most recent report

## GitHub Actions Workflow

### File Location

`.github/workflows/audit.yml` - Runs vulnerability scanning

### What It Does

1. ✅ Checks out code
2. ✅ Runs `npm audit --json`
3. ✅ Parses results and extracts vulnerability counts
4. ✅ Generates SARIF report for GitHub Security tab
5. ✅ Posts results to PR comments
6. ✅ Fails workflow if critical/high vulnerabilities found
7. ✅ Updates GitHub Security dashboard

### Viewing Results

**GitHub Security Tab:**
- Go to repository Settings → Security → Code scanning
- See all detected vulnerabilities with remediation guidance

**PR Comments:**
- Automatic comment on each PR with vulnerability summary
- Shows count by severity level
- Links to detailed security dashboard

**Workflow Logs:**
- Go to Actions → audit workflow run
- See detailed step-by-step execution
- View audit JSON output

## Handling Vulnerabilities

### Critical Vulnerabilities

MUST be fixed before code is merged:

1. Run `npm audit` to see vulnerable packages
2. Review the vulnerability details (CVE, CVSS score, description)
3. Update to patched version: `npm update <package>`
4. Test thoroughly
5. Commit and push

Example:

```bash
# See what's vulnerable
npm audit

# Update specific package
npm update lodash

# Or update all possible
npm audit fix

# Run tests
npm test

# Commit
git add package.json package-lock.json
git commit -m "fix: update lodash to patch critical vulnerability"
```

### High Severity Vulnerabilities

Should be fixed before merging:

1. Assess the vulnerability impact on your application
2. Determine if it's actually exploitable in your use case
3. If exploitable: fix like critical vulnerabilities
4. If not exploitable: document exception (see below)

### Moderate/Low Vulnerabilities

Can be merged but should be addressed in future maintenance:

1. Add to backlog for future updates
2. Document reason if not fixing immediately
3. Set reminder to revisit in next dependency maintenance cycle

### Auto-Fix Vulnerabilities

```bash
# Attempt automatic fixes
npm audit fix

# Review changes
git diff

# Test
npm test

# If good, commit
git add package.json package-lock.json
git commit -m "chore: fix moderate vulnerabilities with npm audit fix"
```

## Exception Process

For vulnerabilities that cannot be immediately fixed:

### 1. Document the Exception

Edit `backend/audit-config.json`:

```json
{
  "exceptions": [
    {
      "id": "CVE-2024-12345",
      "package": "vulnerable-lib",
      "severity": "high",
      "reason": "Vulnerability only affects Node.js version < 14. We use 20.x. Plan to update in Q2 2025.",
      "expiresAt": "2025-06-30T23:59:59Z",
      "approvedBy": "security-team"
    }
  ]
}
```

### 2. Get Approval

- Submit PR with exception documented
- Get security team sign-off
- Document approval in exception record

### 3. Monitor

- Exceptions have expiration dates
- Regular reviews ensure they don't become permanent
- System will warn when expiration approaches

### 4. Remove Exception

Once fixed, remove from exceptions list:

```bash
# Update dependency
npm update vulnerable-lib

# Remove from audit-config.json exceptions array
# Commit
git add audit-config.json package.json package-lock.json
git commit -m "fix: remove vulnerability exception for vulnerable-lib"
```

## Local Development Setup

### Install Git Hooks

Git hooks run audit checks locally before pushing:

```bash
# Run once after cloning
bash backend/scripts/install-hooks.sh
```

### What Hooks Do

**pre-commit hook:**
- Runs if `package.json` or `package-lock.json` staged
- Uses `--level=high` (blocks high/critical)
- Prevents committing with blocking vulnerabilities

**pre-push hook:**
- Always runs before push
- Uses `--level=critical` (blocks only critical)
- Ensures critical fixes before sharing code

### Bypass Hooks (Emergency Only)

```bash
# Commit without hooks
git commit --no-verify

# Push without hooks
git push --no-verify
```

⚠️ **WARNING:** Only use `--no-verify` in true emergencies and with security team approval.

## Dependency Management Best Practices

### Regular Updates

Keep dependencies current for security:

```bash
# Check for outdated packages
npm outdated

# Update all to latest
npm update

# Or use newer versions
npm audit fix
```

### Pinning Versions

Use exact versions or narrow ranges:

```json
{
  "dependencies": {
    "critical-lib": "1.2.3",  // Exact - most secure
    "important-lib": "~1.2.3"  // Patch updates only
  }
}
```

### Review Before Updating

Always test updates:

```bash
npm update <package>
npm test
# If all green, commit
# If broken, revert and investigate
npm install <package>@previous-version
```

## Troubleshooting

### Build Fails with Audit Error

**Problem:** GitHub Actions fails with audit error

**Solution:**
1. Fix locally: `npm audit fix`
2. Run tests: `npm test`
3. Commit: `git add -A && git commit -m "fix: resolve audit vulnerabilities"`
4. Push: `git push`

### Can't Find Vulnerability Details

**Problem:** Audit output doesn't explain what to fix

**Solution:**
```bash
# Get detailed info
npm audit --json | jq '.vulnerabilities'

# Or visit
npm audit | grep "Run  npm install"
# Follow the suggested command
```

### Pre-Push Hook Blocks Everything

**Problem:** `git push --no-verify` is the only way to push

**Solution:**
1. Check audit: `npm audit`
2. Fix issues: `npm audit fix`
3. Test: `npm test`
4. Try push again

### Audit Reports Not Generating

**Problem:** HTML/JSON reports not created

**Solution:**
1. Ensure jq is installed: `which jq`
2. Check script permissions: `chmod +x scripts/audit.sh`
3. Run directly: `bash scripts/audit.sh --html`

## Configuration Reference

### audit-config.json

```json
{
  "auditLevel": "high",  // Fail on this severity
  "failOnCritical": true,  // Always block critical
  "failOnHigh": true,  // Always block high
  "ignoreVulnerabilities": [],  // CVE IDs to ignore (not recommended)
  "ignoredPackages": [],  // Packages to skip auditing
  "exceptions": [],  // Temporary exceptions with expiry
  "reportSettings": {
    "generateHtml": true,  // Create HTML reports
    "generateJson": true,  // Create JSON reports
    "generateSarif": true,  // Create SARIF for GitHub
    "uploadToGitHub": true,  // Post to Security tab
    "notifyOnFindings": true  // Alert maintainers
  },
  "schedule": {
    "dailyAt": "02:00 UTC",
    "weeklyOn": "Monday",
    "weeklyAt": "03:00 UTC"
  }
}
```

## Integration with Other Tools

### npm audit + npm-force-resolutions

For forcing specific package versions:

```bash
# Install tool
npm install --save-dev npm-force-resolutions

# Add to package.json
"scripts": {
  "preinstall": "npx npm-force-resolutions"
}

# Add resolutions section
"resolutions": {
  "lodash": "4.17.21"
}
```

### With Dependabot

GitHub's Dependabot can auto-create PRs for updates:

1. Enable in repository settings
2. Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 5
```

### With Snyk

For more advanced vulnerability scanning, integrate Snyk:

```bash
npm install -g snyk
snyk auth
snyk test
```

## Security Contacts

Report security issues to:
- security-team@company.com
- devops@company.com

See SECURITY.md for full disclosure policy.

## References

- [npm audit documentation](https://docs.npmjs.com/cli/v9/commands/npm-audit)
- [GitHub Security best practices](https://docs.github.com/en/code-security)
- [OWASP Dependency Check](https://owasp.org/www-project-dependency-check/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
