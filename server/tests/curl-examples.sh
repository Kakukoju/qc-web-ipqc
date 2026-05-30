#!/bin/bash
# Manual test examples for Tutti Scan Records API
# Run the server first: cd server && node index.js

BASE="http://localhost:3201/api/v1"

echo "=== GET work order ==="
curl -s "$BASE/tutti-work-orders/WO20250516001" | python3 -m json.tool

echo ""
echo "=== POST scan record (valid) ==="
curl -s -X POST "$BASE/tutti-scan-records" \
  -H "Content-Type: application/json" \
  -d '{
    "workOrder": {
      "workOrderNumber": "WO20250516001",
      "lotNo": "0-001-25051600",
      "finishedBatchNo": "B01",
      "rawQr": "WO|WO20250516001|0-001-25051600|B01"
    },
    "disk": {
      "discLotNo": "0-001-25051600",
      "panelName": "Core Chem 13",
      "productionDate": "2025-05-16",
      "expirationDate": "2026-05-15",
      "rawQr": "00250516000012000010000999990000000000000033010102...",
      "markers": [
        { "markerNumber": "033", "markerName": "UCRE", "used": true },
        { "markerNumber": "034", "markerName": "UPRO", "used": true }
      ]
    },
    "machine": {
      "machineId": "M001",
      "deviceSn": "SN-TUTTI-001",
      "machineName": "Tutti Line 1",
      "rawQr": "MACHINE|M001|SN-TUTTI-001"
    },
    "position": "1",
    "scanTime": "2026-05-24T08:30:00.000Z",
    "operator": "harry"
  }' | python3 -m json.tool

echo ""
echo "=== POST scan record (lot mismatch - should fail) ==="
curl -s -X POST "$BASE/tutti-scan-records" \
  -H "Content-Type: application/json" \
  -d '{
    "workOrder": {
      "workOrderNumber": "WO20250516001",
      "lotNo": "0-001-25051600",
      "finishedBatchNo": "B01"
    },
    "disk": {
      "discLotNo": "9-WRONG-LOT",
      "markers": [{ "markerNumber": "033", "markerName": "UCRE", "used": true }]
    },
    "machine": {},
    "position": "2",
    "scanTime": "2026-05-24T08:30:00.000Z"
  }' | python3 -m json.tool
