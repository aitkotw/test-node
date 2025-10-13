# Project Status - MPC Enclave Service

**Last Updated:** 2025-10-13

## Build Status: ✅ SUCCESS

### Docker Image
- **Name:** `mpc-enclave-server:latest`
- **Size:** 241MB
- **Status:** Built successfully
- **Image ID:** 2c6653be235a

---

## Project Structure

### Two-Application Architecture

```
test-node/
├── Dockerfile                    # Main Docker build (builds enclave app)
├── parent-client.js              # Parent app: HTTP server → vsock client
├── client-sdk.js                 # Client SDK for user devices
├── package.json                  # Parent dependencies
└── enclave/                      # Enclave application
    ├── src/
    │   ├── index.ts              # Enclave: vsock server + MPC handlers
    │   ├── mpc-protocol.ts       # Mock MPC protocol (GG20-style)
    │   ├── keystore.ts           # Sealed storage management
    │   └── types.ts              # TypeScript type definitions
    ├── package.json              # Enclave dependencies (node-vsock, ethers)
    ├── package-lock.json         # ✅ Generated and committed
    ├── build-eif.sh              # Build Docker → EIF
    └── run-enclave.sh            # Run enclave with vsock setup
```

---

## What Works

### ✅ Build System
- Multi-stage Docker build (TypeScript → Production)
- Conditional npm install logic (ci with lock file, install without)
- Non-root user (enclave:enclave, UID/GID 1001)
- Sealed storage directory (`/opt/enclave/sealed`)

### ✅ Dependencies
- **Enclave:** `node-vsock`, `ethers@6.9.0`, TypeScript
- **Parent:** `express`, `axios`, `node-vsock`, `helmet`, `rate-limit`
- **Client SDK:** Pure JavaScript, no dependencies

### ✅ Code Quality
- All TypeScript compilation errors fixed
- ethers v6 API compatibility
- No HTTP server in enclave (pure vsock)
- Proper error handling and structured responses

---

## Issues Fixed (from BUILD-NOTES.md)

### 1. Missing package-lock.json ✅
- Generated `enclave/package-lock.json` via `npm install --package-lock-only`
- Added conditional logic to Dockerfile

### 2. ethers v6 API Changes ✅
- Fixed Wallet instantiation: `new ethers.Wallet('0x' + buffer.toString('hex'))`
- Fixed publicKey access: `wallet.signingKey.publicKey`
- Fixed in 3 locations (lines 149, 240, 292)

### 3. User/Group GID Conflict ✅
- Changed from GID 1000 to 1001
- Resolved Alpine Linux base image conflict

---

## Next Steps

### 1. Convert to EIF (Requires AWS Nitro Enclaves CLI)

**Prerequisites:**
- AWS Nitro Enclaves CLI (`nitro-cli`) installed
- Running on AWS EC2 with Nitro Enclaves support
- Or use `--no-eif` flag for testing without nitro-cli

**Command:**
```bash
cd enclave
./build-eif.sh --production
```

**Output:**
- `enclave.eif` - Enclave Image File
- `enclave-pcr.json` - PCR measurements for attestation

### 2. Run Enclave (Requires Nitro Enclaves)

```bash
cd enclave
./run-enclave.sh --memory 2048 --cpus 2
```

**This will:**
- Stop any existing enclave
- Start enclave with specified resources
- Set up vsock forwarding (socat: vsock:CID:5000 → tcp:127.0.0.1:5000)
- Verify enclave health

### 3. Start Parent Application

```bash
# Terminal 2 (while enclave is running)
cd /Users/abhi/WORKDIR/Playground/nodejs/test-node
node parent-client.js
```

**Parent will:**
- Start HTTP server on port 4000 (configurable via PROXY_PORT)
- Connect to enclave via vsock (CID from run-enclave.sh)
- Forward all `/v1/*` requests to enclave

### 4. Test API Endpoints

```bash
# Terminal 3
cd /Users/abhi/WORKDIR/Playground/nodejs/test-node

# Run full test suite
./test-api.sh

# Or test individual endpoints
curl http://localhost:4000/health
curl http://localhost:4000/v1/health
```

---

## Development Mode (Without Enclave)

For local development without AWS Nitro Enclaves:

### Option 1: Test Enclave Server Standalone
```bash
cd enclave
npm install
npm run dev

# In another terminal
curl http://localhost:5000/v1/health
```

### Option 2: Test via Docker (without EIF conversion)
```bash
docker run --rm -p 5000:5000 \
  -e MOCK_MPC=true \
  -e KEYSTORE_TYPE=memory \
  mpc-enclave-server:latest
```

### Option 3: Mock vsock with TCP
Modify `parent-client.js` to use HTTP instead of vsock:
```javascript
// Replace vsock client with:
const response = await axios.post(`http://localhost:5000${endpoint}`, body);
```

---

## API Endpoints

All endpoints are documented in [API-TEST-EXAMPLES.md](API-TEST-EXAMPLES.md).

### Public Endpoints (Parent: port 4000)
```
GET  /health                      # Parent health check
GET  /v1/health                   # Enclave health check (via vsock)
POST /v1/createAccount/start      # Start DKG (round 1)
POST /v1/createAccount/complete   # Complete DKG (round 2)
POST /v1/sign/start               # Start signing (round 1)
POST /v1/sign/complete            # Complete signing (round 2)
POST /v1/getPublicKey             # Get account public key
POST /v1/recover/start            # Start recovery (round 1)
POST /v1/recover/complete         # Complete recovery (round 2)
```

---

## Configuration

### Enclave Environment Variables
```bash
NODE_ENV=production
VSOCK_PORT=5000
MOCK_MPC=false                    # Set to true for development
KEYSTORE_TYPE=file                # Options: file, memory, kms (TODO)
SEALED_STORAGE_PATH=/opt/enclave/sealed
LOG_LEVEL=info
```

### Parent Environment Variables
```bash
PROXY_PORT=4000                   # HTTP server port
ENCLAVE_CID=16                    # Enclave CID (from run-enclave.sh)
VSOCK_PORT=5000                   # Enclave vsock port
LOG_LEVEL=info
```

---

## Security Notes

### Current State (Development)
- Mock MPC implementation (NOT production-ready)
- File-based sealed storage (placeholder)
- No remote attestation
- No AWS KMS integration

### Production Requirements (TODO)
- [ ] Replace mock MPC with vetted GG20 implementation
- [ ] Implement AWS KMS sealed storage
- [ ] Add remote attestation verification
- [ ] Security audit by cryptographers
- [ ] Load testing (1000+ concurrent requests)
- [ ] Penetration testing
- [ ] Code review by MPC experts

### Never Commit
- Private keys or shards (`*.shard`, `*.meta.json`)
- Sealed storage directory (`/opt/enclave/sealed/`)
- Environment files with secrets (`.env`)
- Backup files (`*-backup.json`)

---

## Documentation

- [README.md](README.md) - Overview and quick start
- [BUILD-NOTES.md](BUILD-NOTES.md) - Build process and fixes
- [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) - Architecture and data flow
- [API-TEST-EXAMPLES.md](API-TEST-EXAMPLES.md) - API testing guide
- [enclave/DEPLOYMENT.md](enclave/DEPLOYMENT.md) - Deployment guide

---

## Troubleshooting

### Docker build fails
```bash
# Clean build
docker system prune -af
docker build -t mpc-enclave-server:latest -f Dockerfile .
```

### TypeScript compilation errors
```bash
cd enclave
npm install
npm run build
```

### Permission errors
```bash
chmod +x enclave/*.sh
chmod +x *.sh
```

### vsock connection fails
- Ensure enclave is running: `nitro-cli describe-enclaves`
- Check CID matches in parent-client.js
- Verify socat forwarding is active

---

## Support

For issues or questions:
1. Check [BUILD-NOTES.md](BUILD-NOTES.md) for common build issues
2. Check [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) for architecture questions
3. Check [API-TEST-EXAMPLES.md](API-TEST-EXAMPLES.md) for API usage
4. Review enclave logs: `nitro-cli console --enclave-id <ID>`

---

**Status:** Ready for EIF conversion and enclave testing 🚀
