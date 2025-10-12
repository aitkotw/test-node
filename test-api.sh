#!/bin/bash

# Test script for Parent API to Enclave communication
# This demonstrates the complete flow of API calls

API_HOST="http://localhost:4000"

echo "========================================="
echo "Testing Parent API to Enclave Flow"
echo "========================================="
echo ""

# Test 1: Parent API Health Check
echo "[Test 1] Parent API Health Check"
echo "---------------------------------"
curl -s "$API_HOST/health" | jq '.'
echo ""
echo ""

# Test 2: Enclave Health Check via Parent API
echo "[Test 2] Enclave Health Check (via Parent API)"
echo "-----------------------------------------------"
curl -s "$API_HOST/api/enclave/health" | jq '.'
echo ""
echo ""

# Test 3: Enclave Status Check
echo "[Test 3] Enclave Status Check"
echo "-----------------------------"
curl -s "$API_HOST/api/enclave/status" | jq '.'
echo ""
echo ""

# Test 4: Generic Compute Request
echo "[Test 4] Generic Compute Request"
echo "---------------------------------"
curl -s -X POST "$API_HOST/api/enclave/compute" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "process",
    "data": "test data",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq '.'
echo ""
echo ""

# Test 5: Sum Operation
echo "[Test 5] Compute - Sum Operation"
echo "---------------------------------"
curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "compute",
    "operation": "sum",
    "payload": [1, 2, 3, 4, 5, 10]
  }' | jq '.'
echo ""
echo ""

# Test 6: Multiply Operation
echo "[Test 6] Compute - Multiply Operation"
echo "--------------------------------------"
curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "compute",
    "operation": "multiply",
    "payload": [2, 3, 4]
  }' | jq '.'
echo ""
echo ""

# Test 7: Encryption
echo "[Test 7] Encrypt Data in Enclave"
echo "---------------------------------"
ENCRYPTED=$(curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "encrypt",
    "payload": {
      "message": "This is sensitive data",
      "user": "test-user",
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }
  }')
echo "$ENCRYPTED" | jq '.'
echo ""
echo ""

# Test 8: Decryption
echo "[Test 8] Decrypt Data in Enclave"
echo "---------------------------------"
ENCRYPTED_DATA=$(echo "$ENCRYPTED" | jq -r '.data.encrypted')
curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "decrypt",
    "payload": "'"$ENCRYPTED_DATA"'"
  }' | jq '.'
echo ""
echo ""

# Test 9: Signing
echo "[Test 9] Sign Data in Enclave"
echo "------------------------------"
SIGNED=$(curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sign",
    "payload": {
      "document": "Important contract",
      "version": "1.0"
    }
  }')
echo "$SIGNED" | jq '.'
echo ""
echo ""

# Test 10: Verification
echo "[Test 10] Verify Signature in Enclave"
echo "--------------------------------------"
SIGNATURE=$(echo "$SIGNED" | jq -r '.data.signature')
curl -s -X POST "$API_HOST/api/enclave/request" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "verify",
    "data": {
      "payload": {
        "document": "Important contract",
        "version": "1.0"
      },
      "signature": "'"$SIGNATURE"'"
    }
  }' | jq '.'
echo ""
echo ""

echo "========================================="
echo "All tests completed!"
echo "========================================="
