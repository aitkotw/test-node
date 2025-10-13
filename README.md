# MPC-Based Two-Party Signing Service

A production-ready Multi-Party Computation (MPC) signing service designed to run in AWS Nitro Enclaves. This implementation uses threshold ECDSA (GG20-style) to enable secure distributed key generation and signing for Ethereum transactions, with the private key split between the enclave and the user's device.

## Architecture Overview

```
┌─────────────┐         HTTPS          ┌──────────────┐       vsock       ┌──────────────┐
│   Client    │ ◄────────────────────► │ Parent-Proxy │ ◄──────────────► │   Enclave    │
│   (Device)  │                        │  (EC2 Parent) │    localhost     │  (Nitro)     │
└─────────────┘                        └──────────────┘     :5000         └──────────────┘
      │                                                                           │
      │ Google OAuth                                                              │
      ▼                                                                           ▼
┌─────────────┐                                                          ┌──────────────┐
│   Google    │                                                          │    Sealed    │
│   Drive     │                                                          │   Storage    │
│  (Backup)   │                                                          │  (KMS/File)  │
└─────────────┘                                                          └──────────────┘
```

### Components

1. **Enclave Server** ([enclave/index.ts](enclave/index.ts))
   - Runs inside AWS Nitro Enclave (isolated, no network egress)
   - Stores server shard in sealed storage
   - Participates in MPC protocols (DKG, signing, recovery)
   - Exposes HTTP API over vsock-forwarded connection

2. **Parent Proxy** ([parent-proxy.js](parent-proxy.js))
   - Runs on EC2 parent instance
   - Terminates HTTPS from clients
   - Forwards requests to enclave via vsock
   - Provides rate limiting, logging, and security

3. **Client SDK** ([client-sdk.js](client-sdk.js))
   - Runs on user's device (browser/Node.js)
   - Stores client shard locally
   - Participates in MPC as second party
   - Handles Google OAuth backup/recovery
   - Assembles final signatures

## Security Model

### Key Distribution
- **Server Shard (SS)**: Stored in enclave sealed storage (AWS KMS/Nitro SDK)
- **Client Shard (CS)**: Stored on user's device (OS keystore/encrypted storage)
- **Full Private Key**: NEVER reconstructed - remains distributed throughout lifecycle

### Threat Model
- **Enclave Compromise**: Attacker gains access to server shard but cannot sign without client shard
- **Client Compromise**: Attacker gains access to client shard but cannot sign without server shard
- **Network MitM**: All communication over HTTPS; enclave has no network egress
- **Google Account Compromise**: Client shard is encrypted before upload; attacker needs passphrase

### Security Properties
- **Threshold (2-of-2)**: Both parties required for signing
- **Sealed Storage**: Server shard protected by AWS Nitro/KMS
- **Client-side Encryption**: Backup encrypted with user-derived key
- **No Network Egress**: Enclave cannot exfiltrate secrets
- **Remote Attestation**: Clients can verify enclave integrity (TODO)

## API Endpoints

All endpoints accept JSON with optional `requestId` field for request tracking.

### Account Creation (DKG)

#### `POST /v1/createAccount/start`
Start distributed key generation.

**Request:**
```json
{
  "requestId": "req-123",
  "label": "My Account",
  "clientNodeId": "client-1"
}
```

**Response:**
```json
{
  "requestId": "req-123",
  "sessionId": "sess-abc123",
  "serverMessage": "<base64>"
}
```

#### `POST /v1/createAccount/step`
Continue multi-round DKG.

**Request:**
```json
{
  "requestId": "req-124",
  "sessionId": "sess-abc123",
  "clientMessage": "<base64>"
}
```

**Response (Continue):**
```json
{
  "requestId": "req-124",
  "sessionId": "sess-abc123",
  "status": "CONTINUE",
  "serverMessage": "<base64>"
}
```

**Response (Done):**
```json
{
  "requestId": "req-124",
  "sessionId": "sess-abc123",
  "status": "DONE",
  "accountId": "acct-xyz789",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

### Public Key Retrieval

#### `POST /v1/getPublicKey`
Get account address and public key.

**Request:**
```json
{
  "requestId": "req-125",
  "accountId": "acct-xyz789"
}
```

**Response:**
```json
{
  "requestId": "req-125",
  "accountId": "acct-xyz789",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "publicKey": "04a1b2c3..."
}
```

### Signing

#### `POST /v1/sign/start`
Start MPC signing session.

**Request:**
```json
{
  "requestId": "req-126",
  "accountId": "acct-xyz789",
  "clientMessage": "<base64 with messageHash>"
}
```

**Response:**
```json
{
  "requestId": "req-126",
  "sessionId": "sess-sign123",
  "serverMessage": "<base64>"
}
```

#### `POST /v1/sign/step`
Continue signing rounds.

**Response (Done):**
```json
{
  "requestId": "req-127",
  "sessionId": "sess-sign123",
  "status": "DONE",
  "serverPartial": "<base64>"
}
```

Client combines `serverPartial` with client partial to produce final signature `(r, s, v)`.

### Recovery

#### `POST /v1/recover/start`
Verify recovered client shard.

**Request:**
```json
{
  "requestId": "req-128",
  "accountId": "acct-xyz789",
  "clientMessage": "<base64>"
}
```

**Response:**
```json
{
  "requestId": "req-128",
  "sessionId": "sess-recover123",
  "status": "DONE",
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

### Health

#### `GET /v1/health`
Service health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-13T12:34:56.789Z",
  "mockMode": true
}
```

### Error Responses

All errors return JSON with structure:

```json
{
  "requestId": "req-123",
  "error": {
    "code": "MPC_ERROR",
    "message": "DKG protocol error",
    "details": {}
  }
}
```

**Error Codes:**
- `INVALID_REQUEST` - Malformed request
- `INVALID_SESSION` - Session not found or expired
- `ACCOUNT_NOT_FOUND` - Account does not exist
- `KEYSTORE_ERROR` - Storage operation failed
- `MPC_ERROR` - MPC protocol error
- `MPC_TIMEOUT` - Session timeout
- `MPC_PARTY_MISSING` - Required party not available
- `MPC_INVALID_SHARE` - Invalid share material
- `SIGNING_ERROR` - Signature generation failed
- `RECOVERY_FAILED` - Recovery verification failed
- `INTERNAL_ERROR` - Unexpected server error

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- AWS Nitro Enclave (for production)
- socat or vsock-proxy (for vsock forwarding)

### Installation

```bash
# Install dependencies for parent proxy
npm install

# Install dependencies for enclave
cd enclave
npm install
cd ..
```

### Development Mode (Local Testing)

Run in mock mode with in-memory storage for local testing:

```bash
# Terminal 1: Start enclave (mock mode)
npm run dev:enclave

# Terminal 2: Start parent proxy
npm run dev:proxy

# Terminal 3: Run client SDK
node
> const { MPCClient } = await import('./client-sdk.js');
> const client = new MPCClient('http://localhost:3000');
> const account = await client.createAccount('Test Account');
> console.log(account);
```

### Client SDK Usage

#### Create Account

```javascript
import { MPCClient } from './client-sdk.js';

const client = new MPCClient('https://your-ec2-host.amazonaws.com');

// Create new account (DKG)
const { accountId, address, clientShard } = await client.createAccount('My Wallet');

console.log(`Account created: ${accountId}`);
console.log(`Address: ${address}`);
// Client shard is automatically stored in client.accounts
```

#### Sign Transaction

```javascript
// Build transaction parameters
const txParams = {
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: ethers.parseEther('0.1'),
  gasLimit: 21000,
  maxFeePerGas: ethers.parseUnits('50', 'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
  nonce: 0,
  chainId: 1, // Mainnet
};

// Sign transaction
const signedTx = await client.signTransaction(accountId, txParams);

console.log(`Signed transaction: ${signedTx}`);

// Broadcast to network
// const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY');
// const txReceipt = await provider.broadcastTransaction(signedTx);
```

#### Sign Message Hash

```javascript
import { ethers } from 'ethers';

const message = 'Hello, world!';
const messageHash = ethers.hashMessage(message);

const signature = await client.signHash(accountId, ethers.getBytes(messageHash));

console.log(`Signature: r=${signature.r}, s=${signature.s}, v=${signature.v}`);
```

#### Backup to Google Drive

```javascript
// Obtain Google OAuth token (implement OAuth flow separately)
const oauthToken = 'ya29.a0AfH6SMBx...'; // From Google OAuth
const passphrase = 'strong-user-passphrase';

await client.backupToGoogle(accountId, passphrase, oauthToken);

console.log('Backup complete!');
```

#### Recover from Google Drive

```javascript
const accountId = 'acct-xyz789';
const passphrase = 'strong-user-passphrase';
const oauthToken = 'ya29.a0AfH6SMBx...';

const recovered = await client.recoverFromGoogle(accountId, passphrase, oauthToken);

console.log(`Recovered account: ${recovered.address}`);
```

#### Export/Import Account

```javascript
// Export for local file backup
const exported = client.exportAccount(accountId);
const backupJson = JSON.stringify(exported);
// Save to file or secure storage

// Import from backup
const backupData = JSON.parse(backupJson);
client.importAccount(backupData);
```

## Production Deployment

### Quick Deploy

For complete deployment instructions, see **[enclave/DEPLOYMENT.md](enclave/DEPLOYMENT.md)**.

#### Quick Steps

1. **Launch EC2 instance** with enclave support (e.g., `m5.xlarge`, `c5.xlarge`)

2. **Install prerequisites:**
   ```bash
   sudo amazon-linux-extras install aws-nitro-enclaves-cli
   sudo yum install -y docker socat jq
   sudo systemctl start nitro-enclaves-allocator docker
   ```

3. **Build enclave image:**
   ```bash
   cd enclave
   ./build-eif.sh --production
   ```

   This creates:
   - `enclave.eif` - Enclave Image File
   - `enclave-pcr.json` - PCR measurements for attestation

4. **Run enclave:**
   ```bash
   ./run-enclave.sh --memory 1024 --cpus 2
   ```

   This automatically:
   - Starts the enclave
   - Sets up vsock forwarding on port 5000
   - Displays enclave information

5. **Start parent proxy:**
   ```bash
   cd ..
   npm run start:proxy
   ```

### Production Files

- **[Dockerfile](enclave/Dockerfile)** - Multi-stage Docker build for enclave
- **[build-eif.sh](enclave/build-eif.sh)** - Build script for EIF with PCR extraction
- **[run-enclave.sh](enclave/run-enclave.sh)** - Run script with vsock setup
- **[DEPLOYMENT.md](enclave/DEPLOYMENT.md)** - Complete deployment guide

### Quick Commands

```bash
# Build enclave image
cd enclave && ./build-eif.sh --production

# Run enclave
./run-enclave.sh

# View enclave status
nitro-cli describe-enclaves

# View console logs
nitro-cli console --enclave-id <id>

# Stop enclave
nitro-cli terminate-enclave --all

# Test health
curl http://localhost:5000/v1/health
```

### Security Hardening

#### Replace Mock MPC

**CRITICAL:** Replace `MockMPCProtocol` with vetted GG20 implementation:

```typescript
// enclave/mpc-protocol.ts
import { GG20Protocol } from '@vetted-library/threshold-ecdsa';

export function createMPCProtocol(mockMode: boolean): MPCProtocol {
  if (mockMode) {
    return new MockMPCProtocol(true);
  }
  return new GG20Protocol(); // Production implementation
}
```

**Recommended libraries to evaluate:**
- ZenGo-X TSS implementations (Rust with WASM bindings)
- @safeheron/crypto-mpc-js
- Custom GG20 implementation with security audit

#### Sealed Storage

Replace file-based storage with AWS KMS/Nitro SDK:

```typescript
// enclave/keystore.ts
async persistServerShard(accountId: string, serverShard: Uint8Array): Promise<void> {
  // Use AWS KMS with enclave attestation
  const encrypted = await kmsEncrypt(serverShard, attestationDoc);
  await fs.writeFile(this.getShardPath(accountId), encrypted, { mode: 0o600 });
}

async loadServerShard(accountId: string): Promise<Uint8Array> {
  const encrypted = await fs.readFile(this.getShardPath(accountId));
  // KMS Decrypt requires valid attestation
  return await kmsDecrypt(encrypted, attestationDoc);
}
```

#### Remote Attestation

Implement attestation verification:

```javascript
// Client-side attestation verification
const attestation = await fetch('https://your-host.com/v1/attestation').then(r => r.json());

// Verify attestation document
const verified = await verifyNitroAttestation(attestation);
if (!verified) {
  throw new Error('Enclave attestation invalid');
}

// Proceed with DKG only if attestation is valid
```

#### Client Shard Storage

Use OS-native secure storage:

**Browser:**
```javascript
// Use IndexedDB with Web Crypto API encryption
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  false,
  ['encrypt', 'decrypt']
);

// Encrypt client shard before storing in IndexedDB
```

**Mobile:**
- iOS: Use Keychain Services API
- Android: Use Android Keystore System

**Desktop:**
- macOS: Keychain Access
- Windows: Windows Credential Manager
- Linux: Secret Service API (libsecret)

#### Google OAuth Implementation

Implement proper OAuth 2.0 flow:

```javascript
// 1. Redirect to Google OAuth
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${REDIRECT_URI}&` +
  `response_type=code&` +
  `scope=https://www.googleapis.com/auth/drive.file&` +
  `access_type=offline&` +
  `prompt=consent`;

window.location.href = authUrl;

// 2. Handle callback and exchange code for token
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: JSON.stringify({
    code: authCode,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }),
});

const { access_token, refresh_token } = await tokenResponse.json();

// 3. Upload to Google Drive
await uploadToGoogleDrive(access_token, encryptedShard);
```

### Monitoring & Operations

#### Logging

Configure structured logging:

```javascript
// enclave/index.ts
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    // In production: send to CloudWatch via parent proxy
  ],
});

// NEVER log secrets
logger.info('DKG started', { accountId, requestId });
```

#### Metrics

Track key metrics:
- DKG success/failure rate
- Signing latency (P50, P95, P99)
- Error rates by error code
- Active sessions count
- Keystore operations

#### Alerting

Set up alerts for:
- High error rates (> 5%)
- Slow response times (> 5s)
- Enclave crashes
- Rate limit exceeded events
- Failed attestation verifications

## Testing

### Mock Mode Integration Test

```javascript
// test-integration.js
import { MPCClient } from './client-sdk.js';
import assert from 'assert';

async function testFullFlow() {
  const client = new MPCClient('http://localhost:3000');

  // Create account
  const account = await client.createAccount('Test');
  assert(account.accountId);
  assert(account.address.startsWith('0x'));

  // Sign transaction
  const txParams = {
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    value: '1000000000000000000',
    gasLimit: 21000,
    nonce: 0,
    chainId: 1,
  };

  const signedTx = await client.signTransaction(account.accountId, txParams);
  assert(signedTx.startsWith('0x'));

  console.log('✓ Integration test passed');
}

testFullFlow().catch(console.error);
```

Run tests:

```bash
npm run test:integration
```

## Project Structure

```
.
├── enclave/                  # Enclave server code
│   ├── index.ts             # Main server with API endpoints
│   ├── types.ts             # TypeScript type definitions
│   ├── keystore.ts          # Sealed storage implementation
│   ├── mpc-protocol.ts      # MPC protocol (mock + interface)
│   ├── package.json         # Enclave dependencies
│   └── tsconfig.json        # TypeScript config
├── parent-proxy.js          # Parent proxy server
├── client-sdk.js            # Client SDK for devices
├── package.json             # Parent/proxy dependencies
└── README.md                # This file
```

## Environment Variables

### Enclave Server

- `PORT` - HTTP port (default: `5000`)
- `MOCK_MPC` - Enable mock mode (`true`/`false`, default: `false`)
- `KEYSTORE_TYPE` - Storage type (`file`/`memory`, default: `file`)
- `SEALED_STORAGE_PATH` - Path for sealed files (default: `/opt/enclave/sealed`)
- `LOG_LEVEL` - Logging level (`debug`/`info`/`warn`/`error`, default: `info`)

### Parent Proxy

- `PROXY_PORT` - HTTPS port (default: `3000`)
- `ENCLAVE_URL` - Enclave endpoint (default: `http://127.0.0.1:5000`)
- `LOG_LEVEL` - Logging level (default: `info`)

### Client SDK

- `MOCK_MPC` - Enable client mock mode (default: `true`)

## Troubleshooting

### Enclave not reachable

Check vsock forwarding:
```bash
# Verify socat is running
ps aux | grep socat

# Test connectivity
curl http://localhost:5000/v1/health
```

### DKG timeout

- Check session timeout configuration
- Verify client and server are using same mock mode
- Check network latency

### Keystore errors

- Verify sealed storage path exists and has correct permissions
- Check disk space
- Verify KMS permissions (production)

## License

ISC

## Contributing

Please conduct security review for any MPC-related changes. All cryptographic code must be audited before production use.

## Disclaimer

**IMPORTANT:** This implementation uses MOCK cryptography for development/testing. DO NOT use in production without replacing mock MPC with vetted threshold ECDSA implementation and implementing proper sealed storage.

## References

- [GG20 Paper](https://eprint.iacr.org/2020/540.pdf) - Fast Multiparty Threshold ECDSA with Fast Trustless Setup
- [AWS Nitro Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)
- [Threshold Signatures Overview](https://docs.zengo.com/threshold-signatures/)
- [ethers.js Documentation](https://docs.ethers.org/)
