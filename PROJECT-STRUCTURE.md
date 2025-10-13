# Project Structure - MPC Two-Party Signing Service

## Overview

This project is organized into **two separate applications**:

1. **Enclave Application** (`enclave/`) - Runs inside AWS Nitro Enclave
2. **Parent Application** (`parent-client.js`) - Runs on EC2 parent instance

```
┌──────────────────────────────────────────────────────────────┐
│                    CLIENT (HTTPS)                             │
│                   (Browser/Device)                            │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTPS (TLS)
                          │
┌─────────────────────────▼────────────────────────────────────┐
│            PARENT APPLICATION (EC2)                           │
│                                                               │
│  parent-client.js (Node.js)                                  │
│  - Express HTTP server                                        │
│  - Exposes MPC API endpoints                                  │
│  - Forwards requests via vsock                                │
│                                                               │
└─────────────────────────┬────────────────────────────────────┘
                          │ vsock
                          │ (port 5000)
┌─────────────────────────▼────────────────────────────────────┐
│            ENCLAVE APPLICATION (Nitro)                        │
│                                                               │
│  enclave/index.ts (TypeScript → Node.js)                     │
│  - vsock server (no HTTP, no external network)               │
│  - MPC protocol handlers                                      │
│  - Sealed storage for server shards                          │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
test-node/
├── Dockerfile                  # Builds enclave application
├── .dockerignore              # Docker build context exclusions
│
├── parent-client.js           # Parent application (vsock client)
├── client-sdk.js              # Client SDK (for user devices)
├── example-client.js          # Example usage
├── test-integration.js        # Integration tests
│
├── enclave/                   # Enclave application
│   ├── index.ts               # vsock server + MPC handlers
│   ├── types.ts               # TypeScript type definitions
│   ├── keystore.ts            # Sealed storage implementation
│   ├── mpc-protocol.ts        # MPC protocol (mock + interface)
│   ├── package.json           # Enclave dependencies
│   ├── tsconfig.json          # TypeScript configuration
│   ├── build-eif.sh           # Build script (Docker → EIF)
│   ├── run-enclave.sh         # Run script (start enclave)
│   ├── .dockerignore          # Enclave build exclusions
│   └── DEPLOYMENT.md          # Deployment guide
│
├── src/                       # Shared utilities (if needed)
│   └── vsock-server.ts        # (legacy, now integrated into enclave/index.ts)
│
├── README.md                  # Main documentation
├── QUICKSTART.md             # Quick start guide
├── ARCHITECTURE.md           # Architecture documentation
└── PROJECT-STRUCTURE.md      # This file
```

## Application Components

### 1. Enclave Application (`enclave/`)

**Purpose:** Runs inside AWS Nitro Enclave, processes MPC operations

**Key Files:**
- `index.ts` - Main vsock server with MPC endpoint handlers
- `mpc-protocol.ts` - MPC protocol implementation (DKG, signing, recovery)
- `keystore.ts` - Sealed storage for server shards
- `types.ts` - TypeScript type definitions

**Communication:**
- **Input:** vsock messages from parent-client.js
- **Output:** vsock responses
- **No external network:** Cannot make HTTP requests, cannot connect to internet

**Build:**
```bash
cd enclave
./build-eif.sh --production    # Builds Docker image → EIF
```

**Run:**
```bash
./run-enclave.sh --memory 2048 --cpus 2
```

**Output:**
- `enclave.eif` - Enclave Image File
- `enclave-pcr.json` - PCR measurements for attestation

### 2. Parent Application (`parent-client.js`)

**Purpose:** Runs on EC2 parent, exposes HTTPS API, forwards to enclave

**Key Features:**
- Express HTTP server
- MPC API endpoints (`/v1/createAccount/*`, `/v1/sign/*`, etc.)
- vsock client (connects to enclave)
- Request/response forwarding
- Error handling and logging

**Communication:**
- **Input:** HTTPS requests from external clients
- **Output:** HTTP responses (data from enclave)
- **vsock:** Communicates with enclave on port 5000

**Run:**
```bash
node parent-client.js
# Or with environment variables:
API_PORT=4000 VSOCK_PORT=5000 node parent-client.js
```

**Environment Variables:**
- `API_PORT` - HTTP port (default: 4000)
- `VSOCK_PORT` - vsock port to enclave (default: 5000)
- `REQUEST_TIMEOUT` - Request timeout in ms (default: 30000)
- `LOG_LEVEL` - Logging level: debug/info/warn/error (default: info)

### 3. Client SDK (`client-sdk.js`)

**Purpose:** Client-side library for MPC operations

**Features:**
- Account creation (DKG)
- Transaction signing
- Message signing
- Google OAuth backup/recovery
- Local shard storage

**Usage:**
```javascript
import { MPCClient } from './client-sdk.js';

const client = new MPCClient('http://localhost:4000');
const account = await client.createAccount('My Wallet');
const signedTx = await client.signTransaction(account.accountId, txParams);
```

## Data Flow

### Account Creation (DKG)

```
Client SDK                Parent-client.js         Enclave (vsock)
    │                            │                        │
    ├──POST /v1/createAccount/start──►                   │
    │                            ├─────vsock─────────────►│
    │                            │                        ├─ MPC: Generate server shard
    │                            │◄─────vsock─────────────┤
    │◄─────────────────────────┤                        │
    │                            │                        │
    ├──POST /v1/createAccount/step (with clientMessage)►│
    │                            ├─────vsock─────────────►│
    │                            │                        ├─ MPC: Process DKG round
    │                            │◄─────vsock─────────────┤
    │◄─────────────────────────┤                        │
    │                            │                        │
    ... (multiple rounds) ...
    │                            │                        │
    │◄─────DONE (accountId, address)──────────────────────┤
    │                            │                        ├─ Save server shard (sealed)
    ├─ Save client shard (local)│                        │
```

### Signing

```
Client SDK                Parent-client.js         Enclave (vsock)
    │                            │                        │
    ├─ Build transaction         │                        │
    ├─ Compute digest            │                        │
    │                            │                        │
    ├──POST /v1/sign/start (with messageHash)───────────►│
    │                            ├─────vsock─────────────►│
    │                            │                        ├─ Load server shard
    │                            │◄─────vsock─────────────┤
    │◄─────────────────────────┤                        │
    │                            │                        │
    ├──POST /v1/sign/step (with clientMessage)──────────►│
    │                            ├─────vsock─────────────►│
    │                            │                        ├─ MPC: Compute sig partial
    │                            │◄─────vsock─────────────┤
    │◄─────serverPartial────────┤                        │
    │                            │                        │
    ├─ Assemble final signature  │                        │
    ├─ Serialize signed tx       │                        │
```

## Build Process

### Building the Enclave

The enclave is built in two stages:

**Stage 1: Docker Image**
```bash
# Dockerfile in root builds enclave/ TypeScript code
docker build -t mpc-enclave-server -f Dockerfile .
```

**Stage 2: Enclave Image File (EIF)**
```bash
# Convert Docker image to EIF using nitro-cli
nitro-cli build-enclave \
  --docker-uri mpc-enclave-server:latest \
  --output-file enclave/enclave.eif
```

**Automated Build:**
```bash
cd enclave
./build-eif.sh --production
```

This script:
1. Checks prerequisites (Docker, nitro-cli)
2. Builds Docker image from root Dockerfile
3. Converts to EIF
4. Extracts PCR measurements
5. Displays summary

## Running the System

### Local Development (Mock Mode)

**Without Enclave (direct Node.js):**
```bash
# Terminal 1: Run enclave code directly (no Docker)
cd enclave
MOCK_MPC=true KEYSTORE_TYPE=memory VSOCK_PORT=5000 node --loader tsx index.ts

# Terminal 2: Run parent (simulated)
API_PORT=4000 node parent-client.js

# Terminal 3: Run tests
node test-integration.js
```

### Production (AWS Nitro Enclave)

**Step 1: Build enclave**
```bash
cd enclave
./build-eif.sh --production
```

**Step 2: Run enclave**
```bash
./run-enclave.sh --memory 2048 --cpus 2
```

**Step 3: Run parent**
```bash
cd ..
API_PORT=4000 VSOCK_PORT=5000 node parent-client.js
```

**Step 4: Test**
```bash
curl http://localhost:4000/health
curl http://localhost:4000/v1/health
```

## vsock Communication

### Protocol

**Request Format:**
```json
{
  "type": "mpc",
  "endpoint": "/v1/createAccount/start",
  "body": {
    "requestId": "req-123",
    "label": "My Account"
  }
}
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "sessionId": "sess-abc",
    "serverMessage": "<base64>"
  },
  "requestId": "req-123",
  "timestamp": "2025-10-13T12:34:56.789Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account acct-xyz not found"
  },
  "requestId": "req-123",
  "timestamp": "2025-10-13T12:34:56.789Z"
}
```

### vsock Configuration

**Enclave Side:**
- Listens on vsock port 5000
- Accepts connections from parent (CID 3)
- No external network

**Parent Side:**
- Connects to enclave CID (obtained via `nitro-cli describe-enclaves`)
- Connects to vsock port 5000
- Forwards HTTP requests as vsock messages

## API Endpoints

All endpoints exposed by parent-client.js:

### Health
- `GET /health` - Parent health check
- `GET /v1/health` - Enclave health check (via vsock)

### Account Creation (DKG)
- `POST /v1/createAccount/start` - Start DKG
- `POST /v1/createAccount/step` - DKG round

### Public Key
- `POST /v1/getPublicKey` - Get account address and public key

### Signing
- `POST /v1/sign/start` - Start signing
- `POST /v1/sign/step` - Signing round

### Recovery
- `POST /v1/recover/start` - Start recovery
- `POST /v1/recover/step` - Recovery round

## Configuration

### Enclave (`enclave/index.ts`)

Environment variables:
- `VSOCK_PORT` - vsock port (default: 5000)
- `MOCK_MPC` - Use mock MPC (default: false)
- `KEYSTORE_TYPE` - Storage type: file/memory (default: file)
- `SEALED_STORAGE_PATH` - Sealed storage path (default: /opt/enclave/sealed)
- `LOG_LEVEL` - Logging level (default: info)

### Parent (`parent-client.js`)

Environment variables:
- `API_PORT` - HTTP port (default: 4000)
- `VSOCK_PORT` - vsock port to enclave (default: 5000)
- `REQUEST_TIMEOUT` - Request timeout ms (default: 30000)
- `LOG_LEVEL` - Logging level (default: info)

### Client SDK (`client-sdk.js`)

Constructor parameter:
- `proxyUrl` - Parent API URL (e.g., `http://localhost:4000`)

## Security Model

### Enclave
- **No external network:** Cannot make HTTP requests
- **Sealed storage:** Server shards encrypted (file-based placeholder, KMS in production)
- **No secrets in logs:** Never log private keys or shards
- **vsock only:** Only communication channel

### Parent
- **TLS termination:** Accepts HTTPS from clients
- **Request forwarding:** Stateless proxy to enclave
- **No access to secrets:** Cannot read server shards
- **Rate limiting:** (TODO) Add rate limiting middleware

### Client
- **Client shard:** Stored on device (OS keystore recommended)
- **Encrypted backup:** Google Drive backup encrypted with user passphrase
- **MPC messages:** Protocol-specific, no raw keys transmitted

## Dependencies

### Enclave
```json
{
  "dependencies": {
    "node-vsock": "^0.0.5",
    "ethers": "^6.9.0"
  }
}
```

### Parent
```json
{
  "dependencies": {
    "express": "^5.1.0",
    "node-vsock": "^0.0.5"
  }
}
```

### Client SDK
```json
{
  "dependencies": {
    "ethers": "^6.9.0"
  }
}
```

## Development Workflow

### 1. Make Changes to Enclave
```bash
# Edit enclave/index.ts, mpc-protocol.ts, etc.
cd enclave

# Test locally (no Docker)
MOCK_MPC=true KEYSTORE_TYPE=memory node --loader tsx index.ts

# Build and test in enclave
./build-eif.sh --mock-mode
./run-enclave.sh
```

### 2. Make Changes to Parent
```bash
# Edit parent-client.js
node parent-client.js

# Test with curl
curl -X POST http://localhost:4000/v1/createAccount/start \
  -H "Content-Type: application/json" \
  -d '{"label":"Test"}'
```

### 3. Run Integration Tests
```bash
node test-integration.js
```

## Production Checklist

- [ ] Replace mock MPC with vetted GG20 implementation
- [ ] Implement AWS KMS sealed storage
- [ ] Add remote attestation verification
- [ ] Set up HTTPS on parent with valid certificate
- [ ] Add rate limiting to parent
- [ ] Configure CloudWatch logging
- [ ] Set up monitoring and alerts
- [ ] Security audit by cryptographers
- [ ] Test disaster recovery
- [ ] Document incident response procedures

## Troubleshooting

### Enclave won't start
```bash
# Check Docker image exists
docker images | grep mpc-enclave-server

# Check enclave allocator
sudo systemctl status nitro-enclaves-allocator

# Check resources
cat /etc/nitro_enclaves/allocator.yaml
```

### Parent can't connect to enclave
```bash
# Check enclave is running
nitro-cli describe-enclaves

# Check enclave CID
nitro-cli describe-enclaves | jq '.[0].EnclaveCID'

# Test vsock manually
# (requires node-vsock and enclave running)
```

### Build fails
```bash
# Check Docker daemon
docker info

# Check build context
cd enclave
./build-eif.sh --production --debug
```

## Additional Resources

- [README.md](README.md) - Main documentation
- [DEPLOYMENT.md](enclave/DEPLOYMENT.md) - Deployment guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - Architecture details
- [QUICKSTART.md](QUICKSTART.md) - Quick start
- [AWS Nitro Enclaves](https://docs.aws.amazon.com/enclaves/)
