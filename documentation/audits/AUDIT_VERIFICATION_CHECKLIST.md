# npm Audit Verification Checklist

Complete this checklist to verify npm audit integration is working correctly.

## File Structure Verification

- [ ] `.github/workflows/audit.yml` exists (GitHub Actions workflow)
- [ ] `backend/scripts/audit.sh` exists and is executable
- [ ] `backend/scripts/install-hooks.sh` exists and is executable
- [ ] `backend/audit-config.json` exists (configuration)
- [ ] `backend/AUDIT_README.md` exists (quick start)
- [ ] `backend/SECURITY_SCANNING.md` exists (full guide)
- [ ] `backend/AUDIT_EXAMPLES.md` exists (examples)
- [ ] `backend/AUDIT_IMPLEMENTATION_SUMMARY.md` exists
- [ ] `.gitignore` updated to exclude audit reports

**Command to verify:**
```bash
ls -la /c/Users/HP/Desktop/MANAWA_NEW/.github/workflows/audit.yml
ls -la /c/Users/HP/Desktop/MANAWA_NEW/backend/scripts/audit.sh
ls -la /c/Users/HP/Desktop/MANAWA_NEW/backend/audit-config.json
```

## Package.json Verification

- [ ] `npm run audit` command exists
- [ ] `npm run audit:fix` command exists
- [ ] `npm run audit:html` command exists
- [ ] `npm run audit:critical` command exists

**Command to verify:**
```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
grep -A 4 '"audit"' package.json
```

**Expected output:**
```json
"audit": "scripts/audit.sh",
"audit:fix": "scripts/audit.sh --fix",
"audit:html": "scripts/audit.sh --html",
"audit:critical": "scripts/audit.sh --level=critical"
```

## Script Verification

### Audit Script

- [ ] Script is executable: `ls -la backend/scripts/audit.sh` shows `x`
- [ ] Script contains main functionality
- [ ] Script has colored output
- [ ] Script creates reports directory

**Command to test:**
```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
bash scripts/audit.sh
# Should output: "Audit Summary" with vulnerability counts
```

### Hook Installation Script

- [ ] Script is executable: `ls -la backend/scripts/install-hooks.sh` shows `x`
- [ ] Script creates hooks directory
- [ ] Script creates pre-commit hook
- [ ] Script creates pre-push hook

**Command to test:**
```bash
# (Don't actually run unless you want to install hooks)
bash /c/Users/HP/Desktop/MANAWA_NEW/backend/scripts/install-hooks.sh
```

## Configuration Verification

### audit-config.json

- [ ] Valid JSON syntax
- [ ] Contains `auditLevel` setting
- [ ] Contains `exceptions` array
- [ ] Contains `reportSettings` object

**Command to verify:**
```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
cat audit-config.json | jq .
# Should not error
```

### .gitignore

- [ ] Contains `backend/audit-reports/`
- [ ] Contains `audit-report.json`
- [ ] Contains `audit.sarif`

**Command to verify:**
```bash
grep -E "(audit|audit-reports)" /c/Users/HP/Desktop/MANAWA_NEW/.gitignore
```

## GitHub Actions Workflow Verification

### File Structure

- [ ] Workflow name: "npm Audit - Dependency Vulnerability Scanning"
- [ ] Triggers on: push, pull_request, schedule
- [ ] Branches: main, develop
- [ ] Paths: backend/package*.json

**Command to view:**
```bash
head -20 /c/Users/HP/Desktop/MANAWA_NEW/.github/workflows/audit.yml
```

### Job Configuration

- [ ] Job name: audit
- [ ] Runs on: ubuntu-latest
- [ ] Node.js version: 20.x
- [ ] Working directory: backend

### Steps

- [ ] Checkout code
- [ ] Setup Node.js
- [ ] Run npm audit
- [ ] Parse audit results
- [ ] Generate SARIF report
- [ ] Upload SARIF to GitHub
- [ ] Create PR comment
- [ ] Fail if critical/high found

**Count steps:**
```bash
grep -c "^\s*-\s*name:" /c/Users/HP/Desktop/MANAWA_NEW/.github/workflows/audit.yml
# Should be 8+
```

## Functional Testing

### Test 1: Basic Audit Run

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# Run audit
npm run audit

# Expected: Outputs vulnerability summary with counts
# Exit code: 0 (no critical/high) or 1 (critical/high found)
```

**Verify:**
- [ ] Command runs without error
- [ ] Shows "npm Audit Report" header
- [ ] Shows vulnerability counts
- [ ] Shows "✅ Audit passed" or "❌ Audit failed"

### Test 2: Audit with Fix

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# Only test if you want to actually fix dependencies
# npm run audit:fix

# Expected: Attempts to fix, runs audit, shows results
```

### Test 3: Audit Script Directly

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# Test with custom level
bash scripts/audit.sh --level=moderate

# Expected: Runs audit at moderate level
```

### Test 4: HTML Report Generation

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# Generate HTML report
npm run audit:html

# Check output
ls -la audit-reports/
```

**Verify:**
- [ ] `audit-reports/` directory exists
- [ ] Contains `audit-YYYY-MM-DD_*.html` file
- [ ] Contains `audit-latest.json` symlink
- [ ] HTML file is readable

### Test 5: Configuration Loading

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# Verify config is valid JSON
jq . audit-config.json

# Expected: Prints formatted JSON without error
```

**Verify:**
- [ ] No JSON parse errors
- [ ] All expected fields present
- [ ] Exceptions array is valid

## Git Integration Verification

### Pre-Commit Hook

```bash
# Check if hook would be installed correctly
cat /c/Users/HP/Desktop/MANAWA_NEW/backend/scripts/install-hooks.sh | grep -A 20 "pre-commit"

# Expected: Shows hook creation code
```

**Verify:**
- [ ] Hook references backend directory correctly
- [ ] Hook runs audit.sh script
- [ ] Hook has proper error handling

### Pre-Push Hook

```bash
# Check if hook would be installed correctly
cat /c/Users/HP/Desktop/MANAWA_NEW/backend/scripts/install-hooks.sh | grep -A 20 "pre-push"

# Expected: Shows hook creation code
```

**Verify:**
- [ ] Hook references backend directory correctly
- [ ] Hook runs with --level=critical
- [ ] Hook exits with error code if vulnerabilities

## Documentation Verification

### AUDIT_README.md

- [ ] Contains quick start section
- [ ] Contains command examples
- [ ] Contains troubleshooting
- [ ] File size > 3 KB

```bash
wc -c /c/Users/HP/Desktop/MANAWA_NEW/backend/AUDIT_README.md
```

### SECURITY_SCANNING.md

- [ ] Contains overview section
- [ ] Contains handling vulnerabilities section
- [ ] Contains exception process section
- [ ] Contains troubleshooting section
- [ ] File size > 8 KB

```bash
wc -c /c/Users/HP/Desktop/MANAWA_NEW/backend/SECURITY_SCANNING.md
```

### AUDIT_EXAMPLES.md

- [ ] Contains 10+ real-world examples
- [ ] Contains step-by-step instructions
- [ ] Contains quick reference
- [ ] File size > 8 KB

```bash
wc -c /c/Users/HP/Desktop/MANAWA_NEW/backend/AUDIT_EXAMPLES.md
```

## Output Verification

### Terminal Output

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
npm run audit
```

**Check for:**
- [ ] Blue border headers
- [ ] Color-coded severity levels
- [ ] Total vulnerabilities count
- [ ] Audit passed/failed message
- [ ] Summary statistics

Example output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NPM Audit Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vulnerability Summary:
├─ Total Dependencies Audited: 250
├─ 🔴 Critical: 0
├─ 🟠 High: 0
├─ 🟡 Moderate: 0
└─ 🔵 Low: 0
   Total Vulnerabilities: 0
```

### Report Files

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW/backend
ls -la audit-reports/ 2>/dev/null || echo "No reports yet (normal if first run)"
```

**Check for:**
- [ ] Directory exists after first run
- [ ] JSON report files created
- [ ] HTML report file created (if --html used)
- [ ] Symlink to latest report

## Integration Verification

### GitHub Actions Ready

- [ ] Workflow file is valid YAML
- [ ] No syntax errors
- [ ] All required keys present

```bash
cd /c/Users/HP/Desktop/MANAWA_NEW
grep -E "on:|jobs:|name:" .github/workflows/audit.yml
# Should show workflow triggers and job names
```

### Ready for CI/CD

- [ ] Can run in Linux environment
- [ ] Uses standard tools (npm, jq, bash)
- [ ] No OS-specific commands
- [ ] Proper error handling

## Security Verification

- [ ] No hardcoded secrets in workflows
- [ ] No hardcoded secrets in scripts
- [ ] audit-config.json doesn't contain sensitive data
- [ ] .gitignore properly excludes reports

```bash
grep -r "password\|key\|secret\|token" /c/Users/HP/Desktop/MANAWA_NEW/.github/ 2>/dev/null | grep -v github-token
# Should return nothing or only ${{ secrets.* }} references
```

## Performance Verification

```bash
time npm run audit
# Should complete in < 30 seconds
```

**Expected:**
- [ ] Completes in reasonable time
- [ ] Resource usage is acceptable
- [ ] No hanging processes

## Final Checklist

### Before Marking Complete

- [ ] All files exist and correct structure
- [ ] Scripts are executable
- [ ] Configuration is valid
- [ ] Documentation is comprehensive
- [ ] GitHub Actions workflow is valid
- [ ] Manual tests pass
- [ ] No sensitive data exposed
- [ ] Performance is acceptable

### Ready for Production

- [ ] All checkboxes above are checked
- [ ] Team has reviewed AUDIT_README.md
- [ ] Hooks installation documented
- [ ] Team aware of PR blocking behavior
- [ ] Security team notified
- [ ] Runbook created for handling failures

## Commands to Run Full Verification

```bash
# Change to backend directory
cd /c/Users/HP/Desktop/MANAWA_NEW/backend

# 1. Check files exist
echo "=== Files Check ===" 
ls -la audit-config.json scripts/audit.sh scripts/install-hooks.sh AUDIT_README.md SECURITY_SCANNING.md AUDIT_EXAMPLES.md

# 2. Check package.json
echo "=== Package Scripts Check ===" 
grep -A 4 '"audit"' package.json

# 3. Check GitHub Actions
echo "=== Workflow Check ===" 
head -10 ../.github/workflows/audit.yml

# 4. Run audit
echo "=== Running Audit ===" 
npm run audit

# 5. Check configuration
echo "=== Config Check ===" 
jq . audit-config.json > /dev/null && echo "✅ Config is valid JSON"
```

## Verification Summary

**Total Checks:** 80+

**Categories:**
- File Structure: 9 checks
- Package.json: 4 checks
- Scripts: 8 checks
- Configuration: 8 checks
- GitHub Actions: 12 checks
- Functional Tests: 5 tests
- Git Integration: 2 checks
- Documentation: 3 checks
- Output: 2 checks
- Security: 4 checks
- Performance: 1 check
- Final Checklist: 6 items

**Status:** ✅ Ready for verification

---

Once all checks are complete, npm audit integration is fully operational and ready for team use!
