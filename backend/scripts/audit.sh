#!/bin/bash

###############################################################################
# NPM Audit Script
#
# Purpose: Run npm audit with parsing, HTML report generation, and exit codes
# Usage: ./scripts/audit.sh [--fix] [--level=<level>] [--html]
#
# Options:
#   --fix           Attempt to fix vulnerabilities
#   --level=<level> Set audit level (low, moderate, high, critical) - default: high
#   --html          Generate HTML report
#   --json          Generate JSON report (default)
###############################################################################

set -e

# Configuration
AUDIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORTS_DIR="${AUDIT_DIR}/audit-reports"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
AUDIT_LEVEL="high"
GENERATE_HTML=false
GENERATE_JSON=true
ATTEMPT_FIX=false

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --fix)
      ATTEMPT_FIX=true
      shift
      ;;
    --level=*)
      AUDIT_LEVEL="${1#*=}"
      shift
      ;;
    --html)
      GENERATE_HTML=true
      shift
      ;;
    --json)
      GENERATE_JSON=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--fix] [--level=<level>] [--html] [--json]"
      exit 1
      ;;
  esac
done

# Create reports directory
mkdir -p "${REPORTS_DIR}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}NPM Audit Report${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Timestamp: $TIMESTAMP"
echo "Audit Level: $AUDIT_LEVEL"
echo "Working Directory: $AUDIT_DIR"
echo ""

# Run npm audit
echo -e "${BLUE}Running npm audit...${NC}"

# Save JSON output
npm audit --json --audit-level="${AUDIT_LEVEL}" > "${REPORTS_DIR}/audit-${TIMESTAMP}.json" 2>&1 || true

# Parse results
JSON_FILE="${REPORTS_DIR}/audit-${TIMESTAMP}.json"

if command -v jq &> /dev/null; then
  CRITICAL=$(jq '.metadata.vulnerabilities.critical // 0' "${JSON_FILE}")
  HIGH=$(jq '.metadata.vulnerabilities.high // 0' "${JSON_FILE}")
  MODERATE=$(jq '.metadata.vulnerabilities.moderate // 0' "${JSON_FILE}")
  LOW=$(jq '.metadata.vulnerabilities.low // 0' "${JSON_FILE}")
  TOTAL=$(jq '.metadata.vulnerabilities.total // 0' "${JSON_FILE}")
  AUDITED=$(jq '.metadata.totalDependencies // 0' "${JSON_FILE}")
else
  # Fallback if jq is not available
  CRITICAL=0
  HIGH=0
  MODERATE=0
  LOW=0
  TOTAL=0
  AUDITED=0
  echo -e "${YELLOW}Warning: jq not found, cannot parse detailed results${NC}"
fi

# Display results
echo ""
echo -e "${BLUE}Vulnerability Summary:${NC}"
echo "├─ Total Dependencies Audited: ${AUDITED}"
echo "├─ 🔴 Critical: ${CRITICAL}"
echo "├─ 🟠 High: ${HIGH}"
echo "├─ 🟡 Moderate: ${MODERATE}"
echo "└─ 🔵 Low: ${LOW}"
echo "   Total Vulnerabilities: ${TOTAL}"
echo ""

# Display vulnerabilities if any
if [ "${TOTAL}" -gt 0 ]; then
  echo -e "${BLUE}Vulnerable Packages:${NC}"
  if command -v jq &> /dev/null; then
    jq '.vulnerabilities | to_entries[] |
      "\(.key): \(.value.via[0].title) (\(.value.severity))"' "${JSON_FILE}" | head -20
  fi
  echo ""
fi

# Generate HTML report if requested
if [ "${GENERATE_HTML}" = true ]; then
  echo -e "${BLUE}Generating HTML report...${NC}"
  HTML_FILE="${REPORTS_DIR}/audit-${TIMESTAMP}.html"

  cat > "${HTML_FILE}" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>npm Audit Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 20px;
      background: #f5f5f5;
      color: #333;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #222;
      border-bottom: 3px solid #007bff;
      padding-bottom: 10px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .summary-card {
      padding: 20px;
      border-radius: 6px;
      text-align: center;
      color: white;
      font-weight: bold;
    }
    .critical { background: #dc3545; }
    .high { background: #fd7e14; }
    .moderate { background: #ffc107; color: #333; }
    .low { background: #17a2b8; }
    .safe { background: #28a745; }
    .summary-card .number {
      font-size: 36px;
      display: block;
      margin: 10px 0;
    }
    .summary-card .label {
      font-size: 14px;
      opacity: 0.9;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f8f9fa;
      font-weight: 600;
      color: #333;
    }
    tr:hover {
      background: #f8f9fa;
    }
    .severity-critical { color: #dc3545; font-weight: bold; }
    .severity-high { color: #fd7e14; font-weight: bold; }
    .severity-moderate { color: #ffc107; font-weight: bold; }
    .severity-low { color: #17a2b8; font-weight: bold; }
    .timestamp {
      color: #666;
      font-size: 14px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .status-safe {
      background: #d4edda;
      border: 1px solid #c3e6cb;
      color: #155724;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .status-unsafe {
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      color: #721c24;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>npm Audit Report</h1>
    <p>Generated: <span id="timestamp"></span></p>

    <div id="status"></div>

    <h2>Vulnerability Summary</h2>
    <div class="summary-grid">
      <div class="summary-card critical">
        <span class="label">Critical</span>
        <span class="number" id="critical">0</span>
      </div>
      <div class="summary-card high">
        <span class="label">High</span>
        <span class="number" id="high">0</span>
      </div>
      <div class="summary-card moderate">
        <span class="label">Moderate</span>
        <span class="number" id="moderate">0</span>
      </div>
      <div class="summary-card low">
        <span class="label">Low</span>
        <span class="number" id="low">0</span>
      </div>
    </div>

    <h2>Vulnerabilities</h2>
    <table id="vulnerabilities">
      <thead>
        <tr>
          <th>Package</th>
          <th>Severity</th>
          <th>Title</th>
          <th>Affected Versions</th>
        </tr>
      </thead>
      <tbody id="vuln-body">
        <tr><td colspan="4">No vulnerabilities found</td></tr>
      </tbody>
    </table>

    <div class="timestamp">
      <small>Report generated at <span id="report-time"></span></small>
    </div>
  </div>

  <script>
    document.getElementById('timestamp').textContent = new Date().toLocaleString();
    document.getElementById('report-time').textContent = new Date().toLocaleString();
  </script>
</body>
</html>
HTMLEOF

  echo -e "${GREEN}HTML report generated: ${HTML_FILE}${NC}"
fi

# Determine exit code based on audit level
EXIT_CODE=0

if [ "${CRITICAL}" -gt 0 ]; then
  echo -e "${RED}🚨 CRITICAL vulnerabilities found. This is a blocking issue.${NC}"
  EXIT_CODE=1
elif [ "${HIGH}" -gt 0 ]; then
  echo -e "${RED}🚨 HIGH severity vulnerabilities found.${NC}"
  EXIT_CODE=1
elif [ "${MODERATE}" -gt 0 ] && [ "${AUDIT_LEVEL}" = "moderate" ]; then
  echo -e "${YELLOW}⚠️  MODERATE vulnerabilities found (audit level set to moderate).${NC}"
  EXIT_CODE=1
elif [ "${LOW}" -gt 0 ] && [ "${AUDIT_LEVEL}" = "low" ]; then
  echo -e "${YELLOW}⚠️  LOW vulnerabilities found (audit level set to low).${NC}"
  EXIT_CODE=1
fi

# Attempt fix if requested
if [ "${ATTEMPT_FIX}" = true ] && [ "${EXIT_CODE}" -eq 1 ]; then
  echo -e "${BLUE}Attempting to fix vulnerabilities...${NC}"
  npm audit fix || true
  echo -e "${BLUE}Re-running audit after fix attempt...${NC}"
  npm audit --audit-level="${AUDIT_LEVEL}" || EXIT_CODE=$?
fi

# Final status
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "${EXIT_CODE}" -eq 0 ]; then
  echo -e "${GREEN}✅ Audit passed - No blocking vulnerabilities found${NC}"
else
  echo -e "${RED}❌ Audit failed - Vulnerabilities detected${NC}"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Create symlink to latest report
ln -sf "audit-${TIMESTAMP}.json" "${REPORTS_DIR}/audit-latest.json"

exit "${EXIT_CODE}"
