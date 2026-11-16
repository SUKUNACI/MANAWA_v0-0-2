#!/bin/bash

echo "Q63 + Q64 Implementation Validation"
echo "==================================="
echo ""

# Check if required files exist
echo "Checking required files..."
files=(
  "utils/sorting-helper.js"
  "config/sortable-fields.js"
  "tests/q63-q64.test.js"
  "Q63_Q64_IMPLEMENTATION.md"
  "IMPLEMENTATION_GUIDE_Q63_Q64.md"
  "FINAL_REPORT_Q63_Q64.md"
)

missing=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file (MISSING)"
    missing=$((missing + 1))
  fi
done

echo ""
echo "Checking route imports..."

# Check if routes have the required imports
routes=(
  "routes/projects.js"
  "routes/quotes.js"
  "routes/users.js"
  "routes/analytics.js"
  "routes/payments.js"
  "routes/notifications.js"
)

updated=0
for route in "${routes[@]}"; do
  if grep -q "buildPaginationQuery" "$route"; then
    echo "✅ $route (imports added)"
    updated=$((updated + 1))
  else
    echo "❌ $route (imports missing)"
  fi
done

echo ""
echo "Summary:"
echo "--------"
echo "Missing files: $missing"
echo "Routes updated: $updated / ${#routes[@]}"

if [ $missing -eq 0 ] && [ $updated -eq ${#routes[@]} ]; then
  echo ""
  echo "✅ All validation checks PASSED!"
  exit 0
else
  echo ""
  echo "⚠️  Some checks failed - review above"
  exit 1
fi
