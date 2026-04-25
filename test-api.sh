#!/bin/bash

# Test drbeads API endpoints
echo "=== Testing Drbeads API Endpoints ==="

API_BASE="http://localhost:3000/qc-web-api/api"
YEAR=$(date +%Y)

echo ""
echo "1. Testing /drbeads/kpi (KPI summary with anomaly count)"
curl -s "$API_BASE/drbeads/kpi?year=$YEAR" | jq . || echo "Failed to fetch KPI"

echo ""
echo "2. Testing /drbeads/ng-lots (NG lots)"
curl -s "$API_BASE/drbeads/ng-lots?year=$YEAR" | jq '.[:2]' || echo "Failed to fetch NG lots"

echo ""
echo "3. Testing /drbeads/anomaly-lots (Anomaly lots - pending/hold)"
curl -s "$API_BASE/drbeads/anomaly-lots?year=$YEAR" | jq '.[:2]' || echo "Failed to fetch anomaly lots"

echo ""
echo "4. Testing /drbeads/records (Get lot details)"
# First get a sample marker
MARKER=$(curl -s "$API_BASE/drbeads/markers?year=$YEAR" | jq -r '.[0]' 2>/dev/null)
if [ ! -z "$MARKER" ] && [ "$MARKER" != "null" ]; then
  echo "Found marker: $MARKER"
  # Get a sheet for this marker
  SHEET=$(curl -s "$API_BASE/drbeads/sheets?bead_name=$MARKER&year=$YEAR" | jq -r '.[0].sheet_name' 2>/dev/null)
  if [ ! -z "$SHEET" ] && [ "$SHEET" != "null" ]; then
    echo "Found sheet: $SHEET"
    echo "Fetching records for $MARKER / $SHEET:"
    curl -s "$API_BASE/drbeads/records?bead_name=$MARKER&sheet_name=$SHEET&year=$YEAR" | jq '.' || echo "Failed"
  fi
fi

echo ""
echo "=== Test Complete ==="
