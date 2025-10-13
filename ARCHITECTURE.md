# MPC Two-Party Signing Service - Architecture

## Overview

This document describes the architecture, security model, and implementation details of the MPC-based two-party signing service designed for AWS Nitro Enclaves.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT DEVICE                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Client SDK (client-sdk.js)                                        │  │
│  │  - MPC Protocol (Client Side)                                      │  │
│  │  - Client Shard Storage (Encrypted)                                │  │
│  │  - Transaction Building                                            │  │
│  │  - Signature Assembly                                              │  │
│  │  - Google OAuth Backup/Recovery                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                               │                                           │
│                               │ HTTPS                                     │
│                               │                                           │
└───────────────────────────────┼───────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         AWS EC2 PARENT INSTANCE                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Parent Proxy (parent-proxy.js)                                    │  │
│  │  - HTTPS Termination                                               │  │
│  │  - Request Forwarding                                              │  │
│  │  - Rate Limiting                                                   │  │
│  │  - Logging & Monitoring                                            │  │
│  │  - (Optional) Attestation Verification                             │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                               │                                           │
│                               │ vsock (port 5000)                         │
│                               │                                           │
│  ┌────────────────────────────▼───────────────────────────────────────┐  │
│  │           AWS NITRO ENCLAVE (Isolated Environment)                 │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  Enclave Server (enclave/index.ts)                           │  │  │
│  │  │  - HTTP API (Express)                                        │  │  │
│  │  │  - MPC Protocol (Server Side)                                │  │  │
│  │  │  - Session Management                                        │  │  │
│  │  │  - Error Handling                                            │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  MPC Protocol (enclave/mpc-protocol.ts)                      │  │  │
│  │  │  - DKG (Distributed Key Generation)                          │  │  │
│  │  │  - Threshold Signing                                         │  │  │
│  │  │  - Recovery Protocol                                         │  │  │
│  │  │  - Mock Implementation (for dev)                             │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  KeyStore (enclave/keystore.ts)                              │  │  │
│  │  │  - Server Shard Storage (Sealed)                             │  │  │
│  │  │  - Account Metadata Storage                                  │  │  │
│  │  │  - File-based (dev) / KMS-backed (prod)                      │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │  No Network Egress                                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                                    │
│  ┌──────────────────┐                                                     │
│  │  Google Drive    │ ◄─── Encrypted Client Shard Backup                 │
│  │  (Cloud Storage) │      (Client-side only)                            │
│  └──────────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. Client SDK (client-sdk.js)

**Purpose:** Runs on user's device and participates as the second party in MPC protocols.

**Responsibilities:**
- Store client shard securely (OS keystore, encrypted storage)
- Participate in DKG rounds with enclave
- Participate in signing rounds with enclave
- Build Ethereum transactions
- Assemble final signatures from MPC partials
- Handle Google OAuth for backup/recovery
- Encrypt/decrypt client shard before cloud backup

**Security Properties:**
- Client shard never leaves device unencrypted
- Google OAuth performed client-side
- Backup encrypted with user-derived key
- No trust in external services (Google only stores encrypted data)

**Key Methods:**
```javascript
createAccount(label)           // Perform DKG
signTransaction(accountId, tx) // Sign Ethereum transaction
signHash(accountId, hash)      // Sign arbitrary message
backupToGoogle(...)           // Backup encrypted shard
recoverFromGoogle(...)        // Recover and verify shard
```

### 2. Parent Proxy (parent-proxy.js)

**Purpose:** Bridge between client and enclave, handle network/TLS termination.

**Responsibilities:**
- Accept HTTPS connections from clients
- Forward requests to enclave via vsock
- Rate limiting and DDoS protection
- Request logging (non-secret data only)
- (Optional) Attestation document serving
- (Optional) Attestation verification

**Security Properties:**
- TLS termination (HTTPS from clients)
- No access to enclave memory or secrets
- Cannot decrypt MPC messages
- Stateless request forwarding

**Endpoints:**
- `GET /health` - Proxy health check
- `POST /v1/*` - Forward to enclave
- `GET /v1/attestation` - (TODO) Serve enclave attestation

### 3. Enclave Server (enclave/index.ts)

**Purpose:** Core MPC service running in isolated AWS Nitro Enclave.

**Responsibilities:**
- Expose HTTP API for MPC operations
- Manage MPC sessions (DKG, signing, recovery)
- Store server shards in sealed storage
- Validate all client inputs
- Return structured errors
- Never allow network egress

**Security Properties:**
- Isolated execution (no network, no external access)
- Sealed storage for server shards
- No logging of secrets
- Session timeouts and cleanup
- Attestation-capable (PCR measurements)

**API Endpoints:**
```
POST /v1/createAccount/start   - Start DKG
POST /v1/createAccount/step    - DKG round
POST /v1/getPublicKey          - Get account info
POST /v1/sign/start            - Start signing
POST /v1/sign/step             - Signing round
POST /v1/recover/start         - Start recovery
POST /v1/recover/step          - Recovery round
GET  /v1/health                - Health check
```

### 4. MPC Protocol (enclave/mpc-protocol.ts)

**Purpose:** Implement threshold ECDSA protocols (GG20-style).

**Responsibilities:**
- Distributed Key Generation (2-of-2)
- Threshold Signing (both parties required)
- Recovery verification
- Session state management
- Message encoding/decoding

**Mock Implementation (Development):**
- Simulates multi-round exchanges
- Deterministic for testing
- Clearly marked as INSECURE for production

**Production TODO:**
- Replace with vetted GG20 library
- Use constant-time operations
- Implement ZK proofs
- Proper abort mechanisms
- Side-channel protections

**Protocol Flows:**

#### DKG (Distributed Key Generation)
```
Client                    Enclave
  │                          │
  ├──► start()               │
  │                          ├──► Generate server commitment
  │    ◄────────────────────┤    (server message 1)
  │                          │
  ├──► step(client msg 1)    │
  │                          ├──► Exchange shares
  │    ◄────────────────────┤    (server message 2)
  │                          │
  ├──► step(client msg 2)    │
  │                          ├──► Finalize
  │                          ├──► Derive public key
  │                          ├──► Save server shard
  │    ◄────────────────────┤    (accountId, address)
  │                          │
```

#### Signing
```
Client                    Enclave
  │                          │
  ├──► start(msg hash)       │
  │                          ├──► Load server shard
  │                          ├──► Generate nonce
  │    ◄────────────────────┤    (server message)
  │                          │
  ├──► step(client msg)      │
  │                          ├──► Compute signature partial
  │    ◄────────────────────┤    (server partial)
  │                          │
  ├──► Assemble signature    │
  │    (r, s, v)             │
  │                          │
```

### 5. KeyStore (enclave/keystore.ts)

**Purpose:** Secure storage for server shards and account metadata.

**Implementations:**
- **InMemoryKeyStore** (development) - Volatile storage in RAM
- **FileSealedKeyStore** (development) - File-based with mode 0600
- **KMSKeyStore** (production TODO) - AWS KMS with attestation

**Responsibilities:**
- Persist server shard (encrypted/sealed)
- Load server shard (decrypt/unseal)
- Store account metadata (address, public key, labels)
- List accounts
- Check account existence

**Security Properties:**
- Server shards never in plaintext outside enclave
- File permissions (0600) prevent other processes
- Production: KMS decryption requires attestation
- Metadata non-secret (addresses, public keys)

## Data Flow

### 1. Account Creation Flow

```
1. Client generates local state
2. Client → Proxy → Enclave: POST /v1/createAccount/start
3. Enclave generates server state, returns serverMessage
4. Client processes serverMessage, generates clientMessage
5. Client → Proxy → Enclave: POST /v1/createAccount/step
6. Repeat steps 4-5 for multiple rounds
7. Final round:
   - Enclave: derives public key, saves server shard
   - Client: saves client shard locally
   - Returns: accountId, address
```

### 2. Signing Flow

```
1. Client builds transaction (to, value, gas, nonce, chainId)
2. Client computes transaction digest (keccak256)
3. Client → Proxy → Enclave: POST /v1/sign/start
   - Includes messageHash in clientMessage
4. Enclave loads server shard
5. Multi-round MPC signing exchange
6. Enclave returns serverPartial
7. Client assembles final signature (r, s, v)
8. Client serializes signed transaction (RLP)
9. Client broadcasts to Ethereum network (external RPC)
```

### 3. Backup/Recovery Flow

**Backup:**
```
1. Client encrypts client shard with user passphrase
   - KDF: PBKDF2/Argon2 (passphrase → encryption key)
   - Encryption: AES-256-GCM
2. Client performs Google OAuth (browser redirect)
3. Client uploads encrypted blob to Google Drive
   - Filename: accountId
   - Metadata: version, algorithm, timestamp
```

**Recovery:**
```
1. Client performs Google OAuth
2. Client downloads encrypted blob from Google Drive
3. Client decrypts with user passphrase
4. Client → Proxy → Enclave: POST /v1/recover/start
   - Includes clientMessage with challenge
5. Enclave verifies client has valid shard
   - ZK proof or challenge-response
6. If verified: client can sign again
7. If failed: recovery rejected
```

## Security Model

### Threat Model

**Assumptions:**
- AWS Nitro Enclave is secure (hardware isolation, attestation)
- Client device is trusted (for client shard storage)
- Parent proxy is semi-trusted (can DoS, cannot read secrets)
- Network is untrusted (requires HTTPS)
- Google account is user-managed (2FA recommended)

**Threats Considered:**

1. **Enclave Compromise**
   - Attacker gains server shard
   - **Mitigation:** Still requires client shard to sign
   - **Impact:** Partial key disclosure, cannot sign alone

2. **Client Compromise**
   - Attacker gains client shard
   - **Mitigation:** Still requires server shard to sign
   - **Impact:** Partial key disclosure, cannot sign alone

3. **Parent Proxy Compromise**
   - Attacker controls proxy
   - **Mitigation:** MPC messages are protocol-specific, no raw keys
   - **Impact:** Can DoS, cannot forge signatures

4. **Network Man-in-the-Middle**
   - Attacker intercepts HTTPS traffic
   - **Mitigation:** TLS encryption
   - **Impact:** Cannot read MPC messages

5. **Google Account Compromise**
   - Attacker gains access to Google Drive backup
   - **Mitigation:** Client shard encrypted, requires passphrase
   - **Impact:** Attacker needs passphrase to decrypt

6. **Malicious Client**
   - Attacker controls client SDK
   - **Mitigation:** Enclave validates all inputs, rate limiting
   - **Impact:** Can DoS, cannot extract server shard

**Threats NOT Considered:**
- Side-channel attacks (timing, cache, power) - requires constant-time crypto
- Quantum attacks - ECDSA vulnerable, requires post-quantum MPC
- Physical attacks on hardware
- Supply chain attacks

### Security Properties

**Confidentiality:**
- Full private key NEVER reconstructed
- Server shard sealed in enclave
- Client shard encrypted on device
- Backups encrypted before cloud storage

**Integrity:**
- Signatures verifiable on-chain
- MPC protocol ensures correctness
- Attestation proves enclave integrity
- Transaction hash signed (not modifiable by proxy)

**Availability:**
- Client can backup shard to cloud
- Multiple recovery options (local, cloud)
- No single point of failure (2-of-2 threshold)

**Authentication:**
- Client proves possession of client shard (recovery protocol)
- Enclave proves identity via attestation (TODO)

### Attack Scenarios

**Scenario 1: Compromised Parent Proxy**
```
Attack: Proxy logs all traffic, tries to extract keys
Result: FAILS - No keys in plaintext, MPC messages unusable
```

**Scenario 2: Stolen Client Device**
```
Attack: Device stolen, client shard in local storage
Result: FAILS - Still needs server shard from enclave
Additional: Use OS keystore (biometric unlock) for client shard
```

**Scenario 3: Malicious Enclave**
```
Attack: Attacker runs modified enclave code
Result: Detectable via remote attestation (PCR mismatch)
Mitigation: Client verifies attestation before DKG
```

**Scenario 4: Replay Attack**
```
Attack: Replay old signing request
Result: FAILS - Session IDs expire, nonce tracking
TODO: Implement replay protection with nonce tracking
```

## Deployment Architecture

### Development (Mock Mode)

```
┌─────────────┐
│  Local PC   │
│             │
│  Node.js    │
│  - Enclave  │ :5000
│  - Proxy    │ :3000
│  - Client   │
└─────────────┘
```

### Production (AWS Nitro)

```
                    ┌────────────────┐
                    │   Route 53     │
                    │   (DNS)        │
                    └────────┬───────┘
                             │
                    ┌────────▼───────┐
                    │      ALB       │
                    │   (HTTPS)      │
                    └────────┬───────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │   EC2 Parent    │          │   EC2 Parent    │
     │   + Proxy       │          │   + Proxy       │
     │                 │          │                 │
     │  ┌───────────┐  │          │  ┌───────────┐  │
     │  │  Enclave  │  │          │  │  Enclave  │  │
     │  │  (Nitro)  │  │          │  │  (Nitro)  │  │
     │  └───────────┘  │          │  └───────────┘  │
     └─────────────────┘          └─────────────────┘
              │                             │
              └──────────────┬──────────────┘
                             │
                    ┌────────▼───────┐
                    │   CloudWatch   │
                    │   (Logs)       │
                    └────────────────┘
```

### Network Configuration

**Enclave:**
- No external network access
- vsock only (to parent)
- Port 5000 (HTTP, vsock-forwarded)

**Parent Proxy:**
- External: HTTPS (443) via ALB
- Internal: HTTP to enclave via vsock (5000)
- CloudWatch Logs agent

**vsock Setup:**
```bash
# On EC2 parent instance
socat TCP-LISTEN:5000,reuseaddr,fork VSOCK-CONNECT:3:5000
```

## Performance Considerations

### Latency

**DKG (Account Creation):**
- Mock: 3 rounds × ~50ms = ~150ms
- Production: 5-7 rounds × 100-200ms = 500-1400ms

**Signing:**
- Mock: 1 round × ~50ms = ~50ms
- Production: 3-5 rounds × 100-200ms = 300-1000ms

**Bottlenecks:**
- Cryptographic operations (ZK proofs, Paillier)
- Network RTT (client ↔ proxy ↔ enclave)
- vsock overhead (minimal, ~1ms)

**Optimizations:**
- Preprocessing (generate commitments ahead of time)
- Pipelining (parallel operations where possible)
- Efficient serialization (protobuf instead of JSON)

### Throughput

**Sessions:**
- Concurrent sessions supported (sessionId tracking)
- Memory: ~1KB per session
- Limit: 10,000 concurrent sessions per enclave

**Rate Limits:**
- Parent proxy: 100 req/15min per IP (configurable)
- Enclave: No built-in limit (relies on proxy)
- Recommend: 10 DKG + 100 sign per account per hour

### Scalability

**Horizontal Scaling:**
- Deploy multiple EC2 + enclave instances
- Use ALB for load balancing
- Session affinity: Not required (stateless after session cleanup)

**Vertical Scaling:**
- Enclave: 512MB-8GB memory
- CPU: 2-16 vCPUs
- Recommended: 1GB memory, 2 vCPUs per enclave

## Monitoring & Operations

### Metrics

**Application Metrics:**
- DKG success rate
- Signing success rate
- Session duration (P50, P95, P99)
- Error rates by error code
- Active sessions count

**Infrastructure Metrics:**
- CPU utilization
- Memory utilization
- Network throughput
- vsock latency

**Security Metrics:**
- Rate limit hits
- Invalid session attempts
- Failed attestation verifications
- Account creation rate (anomaly detection)

### Logging

**Log Events:**
```
INFO: DKG started (accountId, requestId)
INFO: DKG complete (accountId, address)
INFO: Signing started (accountId, requestId)
INFO: Signing complete (accountId, requestId)
ERROR: MPC protocol error (sessionId, errorCode)
WARN: Session timeout (sessionId, protocol)
```

**DO NOT LOG:**
- Server shards
- Client shards
- Private keys (full or partial)
- Signature values before completion
- MPC protocol messages (may leak key info)

### Alerts

**Critical:**
- Enclave crashes
- High error rate (>10% for 5 minutes)
- KMS decryption failures
- Attestation verification failures

**Warning:**
- Elevated latency (>2s P95)
- High memory usage (>80%)
- Elevated rate limit hits
- Unusual account creation patterns

## Production Checklist

### Before Deployment

- [ ] Replace mock MPC with vetted GG20 implementation
- [ ] Implement KMS-backed sealed storage
- [ ] Add remote attestation generation and verification
- [ ] Implement rate limiting per account
- [ ] Add replay protection (nonce tracking)
- [ ] Security audit by qualified cryptographers
- [ ] Penetration testing
- [ ] Load testing (1000 concurrent users)
- [ ] Implement proper logging (CloudWatch)
- [ ] Set up monitoring and alerts
- [ ] Document runbooks for incidents
- [ ] Set up backup/restore procedures
- [ ] Legal review (terms of service, liability)
- [ ] Compliance review (GDPR, SOC2, etc.)

### Deployment Steps

1. Build enclave image (EIF)
2. Deploy EC2 instances with enclave support
3. Configure vsock forwarding
4. Deploy parent proxy with HTTPS
5. Configure ALB and Route 53
6. Enable CloudWatch logging
7. Set up monitoring dashboards
8. Test end-to-end with staging accounts
9. Perform security verification
10. Go live with rate limits enabled

### Ongoing Operations

- [ ] Regular security updates
- [ ] Monthly attestation verification
- [ ] Quarterly security audits
- [ ] Monitor for anomalies
- [ ] Incident response procedures
- [ ] Key rotation policies
- [ ] Disaster recovery testing

## Future Enhancements

### Protocol Improvements

1. **3-of-3 Threshold** - Add third party (backup server)
2. **Account Recovery Service** - Social recovery with threshold
3. **Hardware Wallets** - Client shard in hardware device
4. **Multi-Asset Support** - Bitcoin, Solana, etc.
5. **Batch Signing** - Sign multiple transactions in one session

### Security Enhancements

1. **Post-Quantum MPC** - Quantum-resistant threshold signatures
2. **Secure Multi-Party Computation** - Privacy-preserving analytics
3. **Verifiable Computation** - ZK proofs for all operations
4. **Trusted Execution Environments** - Support for other TEEs

### UX Improvements

1. **Mobile SDK** - iOS and Android native libraries
2. **Browser Extension** - Chrome/Firefox wallet
3. **WalletConnect** - Standard wallet interface
4. **Account Abstraction** - ERC-4337 integration
5. **Gasless Transactions** - Meta-transactions

## References

### Academic Papers
- [GG20] Gennaro & Goldfeder (2020) - Fast Multiparty Threshold ECDSA
- [CGGMP21] Canetti et al. (2021) - UC Non-Interactive Threshold ECDSA
- [Lindell17] Lindell (2017) - Fast Secure Two-Party ECDSA Signing

### Standards
- [EIP-1559] Ethereum Improvement Proposal - Fee Market
- [EIP-2718] Ethereum Typed Transaction Envelope
- [BIP-340] Schnorr Signatures for Bitcoin

### AWS Documentation
- [AWS Nitro Enclaves User Guide](https://docs.aws.amazon.com/enclaves/)
- [KMS with Nitro Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/kms.html)

### Libraries
- [ethers.js](https://docs.ethers.org/)
- [ZenGo TSS](https://github.com/ZenGo-X)
- [Multi-Party ECDSA](https://github.com/coinbase/kryptology)

## License

ISC

## Contributors

See [README.md](README.md) for contribution guidelines.
