# API Test Examples - cURL Commands

Complete set of cURL commands to test all MPC endpoints.

## Prerequisites

```bash
# Make sure parent-client.js is running
node parent-client.js

# Or with custom port
API_PORT=4000 node parent-client.js
```

Base URL: `http://localhost:4000`

## Health Checks

### 1. Parent Health Check

Check if parent API server is running.

```bash
curl -X GET http://localhost:4000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "parent-api",
  "timestamp": "2025-10-13T12:34:56.789Z"
}
```

### 2. Enclave Health Check

Check if enclave is running and accessible via vsock.

```bash
curl -X GET http://localhost:4000/v1/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-13T12:34:56.789Z",
  "mockMode": true,
  "enclave": true
}
```

**Error Response (if enclave not running):**
```json
{
  "error": {
    "code": "ENCLAVE_UNAVAILABLE",
    "message": "Failed to connect to enclave. Make sure nitro-cli is installed and an enclave is running."
  }
}
```

---

## Account Creation (DKG)

### 3. Create Account - Start

Initiate distributed key generation.

```bash
curl -X POST http://localhost:4000/v1/createAccount/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-001",
    "label": "My Test Wallet",
    "clientNodeId": "client-node-1"
  }'
```

**Expected Response:**
```json
{
  "requestId": "req-001",
  "sessionId": "sess-abc123def456...",
  "serverMessage": "eyJyb3VuZCI6MSwidHlwZSI6ImRrZ19jb21taXRtZW50IiwiZGF0YSI6eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19fQ=="
}
```

**Response Fields:**
- `sessionId` - Session identifier for subsequent steps
- `serverMessage` - Base64-encoded MPC message from server

### 4. Create Account - Step (Round 2)

Continue DKG with client's response.

```bash
# Save sessionId from previous response
SESSION_ID="sess-abc123def456..."

curl -X POST http://localhost:4000/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19"
  }'
```

**Expected Response (Continue):**
```json
{
  "requestId": "req-002",
  "sessionId": "sess-abc123def456...",
  "status": "CONTINUE",
  "serverMessage": "eyJyb3VuZCI6MiwidHlwZSI6ImRrZ19zaGFyZV9jb21taXRtZW50IiwiZGF0YSI6eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19fQ=="
}
```

**Expected Response (Final Round - DONE):**
```json
{
  "requestId": "req-003",
  "sessionId": "sess-abc123def456...",
  "status": "DONE",
  "accountId": "acct-1234567890abcdef",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

**Response Fields (DONE):**
- `accountId` - Unique account identifier (save this!)
- `address` - Ethereum address derived from public key

### 5. Create Account - Complete Flow Example

```bash
# Step 1: Start DKG
RESPONSE=$(curl -s -X POST http://localhost:4000/v1/createAccount/start \
  -H "Content-Type: application/json" \
  -d '{"requestId":"req-001","label":"Test Wallet"}')

echo "Start Response: $RESPONSE"

# Extract sessionId
SESSION_ID=$(echo $RESPONSE | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# Step 2: Continue DKG (multiple rounds)
# In real implementation, client would process serverMessage
# and generate clientMessage based on MPC protocol

curl -X POST http://localhost:4000/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-002",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19"
  }'

# Repeat until status: "DONE"
```

---

## Get Public Key

### 6. Get Public Key

Retrieve account information (address and public key).

```bash
# Use accountId from account creation
ACCOUNT_ID="acct-1234567890abcdef"

curl -X POST http://localhost:4000/v1/getPublicKey \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-004",
    "accountId": "'$ACCOUNT_ID'"
  }'
```

**Expected Response:**
```json
{
  "requestId": "req-004",
  "accountId": "acct-1234567890abcdef",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "publicKey": "04a1b2c3d4e5f6..."
}
```

**Error Response (Account Not Found):**
```json
{
  "code": "ACCOUNT_NOT_FOUND",
  "message": "Account acct-invalid not found"
}
```

---

## Signing

### 7. Sign - Start

Initiate MPC signing for a transaction.

```bash
# Account ID from previous steps
ACCOUNT_ID="acct-1234567890abcdef"

# Message hash to sign (32 bytes hex, e.g., transaction hash)
MESSAGE_HASH="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

# Client must send messageHash in clientMessage
CLIENT_MESSAGE=$(echo '{"messageHash":"'$MESSAGE_HASH'","round":1}' | base64)

curl -X POST http://localhost:4000/v1/sign/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-005",
    "accountId": "'$ACCOUNT_ID'",
    "clientMessage": "'$CLIENT_MESSAGE'"
  }'
```

**Expected Response:**
```json
{
  "requestId": "req-005",
  "sessionId": "sess-sign123abc...",
  "serverMessage": "eyJyb3VuZCI6MSwidHlwZSI6InNpZ25fbm9uY2VfY29tbWl0bWVudCIsImRhdGEiOnsidHlwZSI6IkJ1ZmZlciIsImRhdGEiOlsxMjMsMzQsNTYsNzhdfX0="
}
```

### 8. Sign - Step

Continue signing protocol.

```bash
SESSION_ID="sess-sign123abc..."

curl -X POST http://localhost:4000/v1/sign/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-006",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19"
  }'
```

**Expected Response (DONE):**
```json
{
  "requestId": "req-006",
  "sessionId": "sess-sign123abc...",
  "status": "DONE",
  "serverPartial": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OCwxMjMsMzQsNTYsNzgsMTIzLDM0LDU2LDc4LDEyMywzNCw1Niw3OCwxMjMsMzQsNTYsNzgsMTIzLDM0LDU2LDc4LDEyMywzNCw1Niw3OCwxMjMsMzQsNTYsNzhdfQ=="
}
```

**Response Fields:**
- `serverPartial` - Base64-encoded signature partial from server
- Client combines with own partial to create final signature (r, s, v)

### 9. Sign - Complete Flow Example

```bash
ACCOUNT_ID="acct-1234567890abcdef"
MESSAGE_HASH="deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678"

# Start signing
CLIENT_MESSAGE=$(echo '{"messageHash":"'$MESSAGE_HASH'","round":1}' | base64)

RESPONSE=$(curl -s -X POST http://localhost:4000/v1/sign/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-sign-001",
    "accountId": "'$ACCOUNT_ID'",
    "clientMessage": "'$CLIENT_MESSAGE'"
  }')

echo "Sign Start: $RESPONSE"

SESSION_ID=$(echo $RESPONSE | jq -r '.sessionId')

# Continue signing
curl -X POST http://localhost:4000/v1/sign/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-sign-002",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19"
  }'
```

---

## Recovery

### 10. Recover - Start

Verify recovered client shard.

```bash
ACCOUNT_ID="acct-1234567890abcdef"

# Client message with recovery challenge
CLIENT_MESSAGE=$(echo '{"type":"recovery_challenge","data":"random-challenge-hex"}' | base64)

curl -X POST http://localhost:4000/v1/recover/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-007",
    "accountId": "'$ACCOUNT_ID'",
    "clientMessage": "'$CLIENT_MESSAGE'"
  }'
```

**Expected Response (DONE):**
```json
{
  "requestId": "req-007",
  "sessionId": "sess-recover123...",
  "status": "DONE",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

**Response Fields:**
- `address` - Verified Ethereum address (confirms client shard is valid)

### 11. Recover - Step

Continue recovery protocol (if multi-round).

```bash
SESSION_ID="sess-recover123..."

curl -X POST http://localhost:4000/v1/recover/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-008",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIiwiZGF0YSI6WzEyMywzNCw1Niw3OF19"
  }'
```

**Expected Response:**
```json
{
  "requestId": "req-008",
  "sessionId": "sess-recover123...",
  "status": "DONE",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

---

## Error Scenarios

### 12. Invalid Session

```bash
curl -X POST http://localhost:4000/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-error-001",
    "sessionId": "invalid-session-id",
    "clientMessage": "eyJ0eXBlIjoiQnVmZmVyIn0="
  }'
```

**Expected Response:**
```json
{
  "code": "INVALID_SESSION",
  "message": "INVALID_SESSION: Session not found or expired"
}
```

### 13. Account Not Found

```bash
curl -X POST http://localhost:4000/v1/getPublicKey \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-error-002",
    "accountId": "acct-nonexistent"
  }'
```

**Expected Response:**
```json
{
  "code": "ACCOUNT_NOT_FOUND",
  "message": "ACCOUNT_NOT_FOUND: Account acct-nonexistent not found"
}
```

### 14. Invalid Request

```bash
curl -X POST http://localhost:4000/v1/sign/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req-error-003",
    "accountId": "acct-1234"
  }'
```

**Expected Response:**
```json
{
  "code": "INVALID_REQUEST",
  "message": "INVALID_REQUEST: clientMessage with messageHash required"
}
```

### 15. Enclave Unavailable

```bash
# Stop the enclave first, then:
curl -X GET http://localhost:4000/v1/health
```

**Expected Response:**
```json
{
  "error": {
    "code": "ENCLAVE_UNAVAILABLE",
    "message": "Failed to connect to enclave..."
  }
}
```

---

## Complete End-to-End Test Script

Save this as `test-api.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:4000"

echo "================================"
echo "MPC API End-to-End Test"
echo "================================"

# 1. Check parent health
echo -e "\n1. Testing parent health..."
curl -s $BASE_URL/health | jq

# 2. Check enclave health
echo -e "\n2. Testing enclave health..."
curl -s $BASE_URL/v1/health | jq

# 3. Create account - Start
echo -e "\n3. Creating account (start)..."
CREATE_START=$(curl -s -X POST $BASE_URL/v1/createAccount/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-001",
    "label": "Test Wallet"
  }')
echo $CREATE_START | jq

SESSION_ID=$(echo $CREATE_START | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# 4. Create account - Step 1
echo -e "\n4. Creating account (step 1)..."
CLIENT_MSG=$(echo '{"round":1,"data":"test"}' | base64)
CREATE_STEP1=$(curl -s -X POST $BASE_URL/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-002",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "'$CLIENT_MSG'"
  }')
echo $CREATE_STEP1 | jq

# 5. Create account - Step 2
echo -e "\n5. Creating account (step 2)..."
CREATE_STEP2=$(curl -s -X POST $BASE_URL/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-003",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "'$CLIENT_MSG'"
  }')
echo $CREATE_STEP2 | jq

# 6. Create account - Step 3 (Final)
echo -e "\n6. Creating account (step 3 - final)..."
CREATE_FINAL=$(curl -s -X POST $BASE_URL/v1/createAccount/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-004",
    "sessionId": "'$SESSION_ID'",
    "clientMessage": "'$CLIENT_MSG'"
  }')
echo $CREATE_FINAL | jq

ACCOUNT_ID=$(echo $CREATE_FINAL | jq -r '.accountId')
ADDRESS=$(echo $CREATE_FINAL | jq -r '.address')
echo "Account ID: $ACCOUNT_ID"
echo "Address: $ADDRESS"

# 7. Get public key
echo -e "\n7. Getting public key..."
curl -s -X POST $BASE_URL/v1/getPublicKey \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-005",
    "accountId": "'$ACCOUNT_ID'"
  }' | jq

# 8. Sign transaction
echo -e "\n8. Signing transaction..."
MESSAGE_HASH="deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678"
SIGN_CLIENT_MSG=$(echo '{"messageHash":"'$MESSAGE_HASH'","round":1}' | base64)

SIGN_START=$(curl -s -X POST $BASE_URL/v1/sign/start \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-006",
    "accountId": "'$ACCOUNT_ID'",
    "clientMessage": "'$SIGN_CLIENT_MSG'"
  }')
echo $SIGN_START | jq

SIGN_SESSION=$(echo $SIGN_START | jq -r '.sessionId')

# 9. Sign step (final)
echo -e "\n9. Signing step (final)..."
curl -s -X POST $BASE_URL/v1/sign/step \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-007",
    "sessionId": "'$SIGN_SESSION'",
    "clientMessage": "'$CLIENT_MSG'"
  }' | jq

echo -e "\n================================"
echo "Test Complete!"
echo "================================"
```

Run it:
```bash
chmod +x test-api.sh
./test-api.sh
```

---

## Using with jq for Pretty Output

Install jq for formatted JSON output:

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Then pipe curl output:
curl http://localhost:4000/health | jq
```

---

## Environment Variables

Override default settings:

```bash
# Change API port
API_PORT=8080 node parent-client.js

# Test with custom port
curl http://localhost:8080/health

# Change vsock port
VSOCK_PORT=6000 node parent-client.js

# Enable debug logging
LOG_LEVEL=debug node parent-client.js
```

---

## Response Time Testing

Measure API response time:

```bash
curl -X GET http://localhost:4000/health \
  -w "\nTime: %{time_total}s\n" \
  -o /dev/null -s
```

---

## Troubleshooting

### Connection Refused
```bash
# Check if parent-client.js is running
ps aux | grep parent-client

# Check port
lsof -i :4000
```

### Enclave Not Responding
```bash
# Check enclave status
nitro-cli describe-enclaves

# Check enclave logs
nitro-cli console --enclave-id <id>
```

### Invalid JSON
```bash
# Validate JSON with jq before sending
echo '{"test": "data"}' | jq
```

---

## Summary of All Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Parent health |
| GET | `/v1/health` | Enclave health |
| POST | `/v1/createAccount/start` | Start DKG |
| POST | `/v1/createAccount/step` | DKG round |
| POST | `/v1/getPublicKey` | Get account info |
| POST | `/v1/sign/start` | Start signing |
| POST | `/v1/sign/step` | Signing round |
| POST | `/v1/recover/start` | Start recovery |
| POST | `/v1/recover/step` | Recovery round |
