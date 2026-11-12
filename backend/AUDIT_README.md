# npm Audit Setup Guide

Quick start for npm audit integration in MANAWA backend.

## 🚀 Quick Start

### 1. Install Git Hooks (Local Development)

```bash
cd backend
bash scripts/install-hooks.sh
```

This installs:
- `pre-commit` - Checks dependencies before committing
- `pre-push` - Verifies no critical vulnerabilities before pushing

### 2. Run Your First Audit

```bash
# Basic audit (shows vulnerabilities)
npm run audit

# With automatic fixes
npm run audit:fix

# Generate HTML report
npm run audit:html
```

### 3. View Results

Reports are saved to `backend/audit-reports/`:

```bash
# View latest JSON report
cat audit-reports/audit-latest.json

# Open HTML report in browser
open audit-reports/audit-YYYY-MM-DD_*.html
```

## 📊 CI/CD Integration

GitHub Actions automatically:

1. ✅ Scans dependencies on every push to main/develop
2. ✅ Runs daily and weekly scheduled scans
3. ✅ Posts results to pull requests
4. ✅ Updates GitHub Security dashboard
5. ✅ **Blocks merge if critical/high vulnerabilities found**

No additional setup needed - workflows are already configured in `.github/workflows/audit.yml`

## 🔍 Understanding Results

### Vulnerability Severity

| Level | Action | Block PR |
|-------|--------|----------|
| 🔴 **Critical** | Fix immediately | YES |
| 🟠 **High** | Fix before merge | YES |
| 🟡 **Moderate** | Fix in maintenance | NO |
| 🔵 **Low** | Monitor | NO |

### Common Vulnerabilities

```bash
# See all vulnerabilities
npm audit

# Focus on critical only
npm audit --audit-level=critical

# Export to JSON for analysis
npm audit --json > audit.json
```

## 🔧 Fixing Vulnerabilities

### Automatic Fix (Recommended First)

```bash
cd backend
npm audit fix
npm test  # Always test after fixing
git add package.json package-lock.json
git commit -m "fix: resolve audit vulnerabilities"
```

### Manual Fix (When Automatic Fails)

```bash
# 1. Identify vulnerable package
npm audit

# 2. Update to safe version
npm install package-name@latest

# 3. Test thoroughly
npm test

# 4. Check if vulnerability resolved
npm audit

# 5. Commit
git add package.json package-lock.json
git commit -m "fix: update package-name to safe version"
```

## ⚙️ Configuration

### audit-config.json

Located in `backend/audit-config.json`:

```json
{
  "auditLevel": "high",        // Fail on high/critical
  "failOnCritical": true,      // Always block critical
  "failOnHigh": true,          // Always block high
  "exceptions": [              // Temporary exceptions
    {
      "package": "example",
      "reason": "Will update in v2.0",
      "expiresAt": "2025-12-31T23:59:59Z"
    }
  ]
}
```

## 📋 Available Commands

```bash
npm run audit              # Run audit with default settings
npm run audit:fix          # Run audit and attempt fixes
npm run audit:html         # Generate HTML report
npm run audit:critical     # Check critical only
bash scripts/audit.sh      # Custom options
```

## 🆘 Troubleshooting

### Git Hook Blocks Commit

```bash
# Check what's wrong
npm run audit

# Fix issues
npm audit fix

# Try commit again
git add -A
git commit -m "your message"
```

### Pre-Push Hook Always Fails

```bash
# Check for critical vulnerabilities
npm audit --audit-level=critical

# If none found, hook may be misconfigured
bash scripts/install-hooks.sh  # Reinstall
```

### Can't Push Due to Audit

Only as last resort:
```bash
git push --no-verify
```

⚠️ Still need to fix vulnerabilities before PR can merge!

## 📚 Documentation

Full detailed guide: `SECURITY_SCANNING.md`

## 🤝 Need Help?

1. Check `SECURITY_SCANNING.md` for detailed guide
2. Run `npm audit --help` for npm options
3. See GitHub Actions logs: Settings → Actions → audit workflow

## 🔐 Security Best Practices

- ✅ Always run audit before pushing
- ✅ Fix critical/high immediately
- ✅ Keep dependencies updated
- ✅ Review update changelogs
- ✅ Test thoroughly after updates
- ✅ Document exceptions with reasons

## 📅 Maintenance Schedule

- **Daily scan**: 2:00 AM UTC (automatic)
- **Weekly scan**: Monday 3:00 AM UTC (automatic)
- **On PR**: Automatic
- **Before push**: Local hook runs

No manual maintenance needed unless exceptions are required.
