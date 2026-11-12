#!/bin/bash

echo "========================================================================"
echo "Q55 + Q56 Implementation Verification"
echo "========================================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Counter
PASS=0
FAIL=0

# Function to check file exists
check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} File exists: $1"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} File missing: $1"
    ((FAIL++))
  fi
}

# Function to check syntax
check_syntax() {
  if node -c "$1" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Syntax OK: $1"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} Syntax error: $1"
    ((FAIL++))
  fi
}

echo "Checking Q55 Files..."
check_file "middleware/webhook-signature-verification.js"
check_syntax "middleware/webhook-signature-verification.js"

echo ""
echo "Checking Q56 Files..."
check_file "config/webhook-queue-config.js"
check_syntax "config/webhook-queue-config.js"
check_file "utils/webhook-queue-manager.js"
check_syntax "utils/webhook-queue-manager.js"

echo ""
echo "Checking Test Files..."
check_file "tests/webhooks-q55-q56.test.js"

echo ""
echo "Checking Documentation..."
check_file "Q55_Q56_IMPLEMENTATION.md"
check_file "INTEGRATION_Q55_Q56.md"
check_file "Q55_Q56_SUMMARY.txt"

echo ""
echo "Checking Modified Files..."
grep -q "sequence" prisma/schema.prisma && {
  echo -e "${GREEN}✓${NC} prisma/schema.prisma contains 'sequence'"
  ((PASS++))
} || {
  echo -e "${RED}✗${NC} prisma/schema.prisma missing 'sequence'"
  ((FAIL++))
}

grep -q "idempotencyKey" prisma/schema.prisma && {
  echo -e "${GREEN}✓${NC} prisma/schema.prisma contains 'idempotencyKey'"
  ((PASS++))
} || {
  echo -e "${RED}✗${NC} prisma/schema.prisma missing 'idempotencyKey'"
  ((FAIL++))
}

grep -q "webhookQueue" config/queue.js && {
  echo -e "${GREEN}✓${NC} config/queue.js exports webhookQueue"
  ((PASS++))
} || {
  echo -e "${RED}✗${NC} config/queue.js missing webhookQueue export"
  ((FAIL++))
}

grep -q "captureRawBody\|webhookSignatureVerification" index.js && {
  echo -e "${GREEN}✓${NC} index.js includes Q55/Q56 setup"
  ((PASS++))
} || {
  echo -e "${RED}✗${NC} index.js missing Q55/Q56 setup"
  ((FAIL++))
}

echo ""
echo "========================================================================"
echo "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "========================================================================"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some checks failed${NC}"
  exit 1
fi
