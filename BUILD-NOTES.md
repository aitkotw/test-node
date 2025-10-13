# Build Notes - Fixes and Solutions

## Build Success ✅

**Docker Image:** `mpc-enclave-server:latest` (241MB)

The Docker image has been successfully built and is ready for conversion to EIF (Enclave Image File).

---

## Issues Fixed

### 1. Missing package-lock.json

**Error:**
```
npm error The `npm ci` command can only install with an existing package-lock.json
```

**Solution:**
```bash
cd enclave
npm install --package-lock-only
```

This generated `enclave/package-lock.json` which is now committed.

**Dockerfile Update:**
Added conditional logic to handle missing package-lock.json:
```dockerfile
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi
```

### 2. ethers v6 API Changes

**Error:**
```
mpc-protocol.ts(149,40): error TS2345: Argument of type 'Buffer<ArrayBufferLike>'
is not assignable to parameter of type 'string | SigningKey'.
```

**Problem:**
ethers v6 Wallet constructor expects hex string, not Buffer.

**Solution:**
Changed all instances from:
```typescript
const wallet = new ethers.Wallet(buffer);
```

To:
```typescript
const wallet = new ethers.Wallet('0x' + buffer.toString('hex'));
```

**Fixed in:**
- Line 149: DKG finalization
- Line 240: Signing with server shard
- Line 292: Recovery verification

### 3. publicKey Property Access

**Error:**
```
mpc-protocol.ts(153,44): error TS2339: Property 'publicKey' does not exist on type 'Wallet'.
```

**Problem:**
In ethers v6, public key is accessed via `wallet.signingKey.publicKey`.

**Solution:**
```typescript
// OLD (ethers v5)
const publicKey = wallet.publicKey;

// NEW (ethers v6)
const signingKey = wallet.signingKey;
const publicKey = signingKey.publicKey;
```

### 4. User/Group GID Conflict

**Error:**
```
addgroup: gid '1000' in use
```

**Problem:**
GID 1000 already exists in node:18-alpine base image.

**Solution:**
Changed from GID 1000 to GID 1001:
```dockerfile
RUN addgroup -g 1001 enclave && \
    adduser -D -u 1001 -G enclave enclave && \
    chown -R enclave:enclave /app /opt/enclave
```

---

## Dockerfile Structure

### Stage 1: Builder (TypeScript Compilation)
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /build
COPY enclave/package.json ./
COPY enclave/package-lock.json* ./
RUN npm ci || npm install
COPY enclave/ ./
RUN npm run build
```

### Stage 2: Production Runtime
```dockerfile
FROM node:18-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY enclave/package.json ./
COPY enclave/package-lock.json* ./
RUN npm ci --only=production || npm install --production
COPY --from=builder /build/dist ./dist
RUN mkdir -p /opt/enclave/sealed && chmod 700 /opt/enclave/sealed
RUN addgroup -g 1001 enclave && \
    adduser -D -u 1001 -G enclave enclave && \
    chown -R enclave:enclave /app /opt/enclave
USER enclave
ENTRYPOINT ["dumb-init", "--"]
CMD ["/usr/local/bin/node", "/app/dist/index.js"]
```

---

## Build Commands

### Manual Build
```bash
docker build -t mpc-enclave-server:latest -f Dockerfile .
```

### Using build-eif.sh Script
```bash
cd enclave
./build-eif.sh --production
```

This script:
1. Builds Docker image
2. Converts to EIF using nitro-cli
3. Extracts PCR measurements
4. Saves to `enclave/enclave.eif`

---

## Verification

### Check Docker Image
```bash
docker images mpc-enclave-server:latest
```

Expected output:
```
REPOSITORY           TAG       IMAGE ID       CREATED         SIZE
mpc-enclave-server   latest    2c6653be235a   X seconds ago   241MB
```

### Test Docker Image Locally
```bash
docker run --rm mpc-enclave-server:latest node --version
# Should output: v18.x.x
```

### Inspect Image
```bash
docker inspect mpc-enclave-server:latest
```

---

## Dependencies

### Enclave Application
```json
{
  "dependencies": {
    "node-vsock": "^0.0.5",
    "ethers": "^6.9.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

---

## Next Steps

### 1. Convert to EIF (Requires AWS Nitro Enclaves CLI)

```bash
cd enclave
./build-eif.sh --production
```

This creates:
- `enclave.eif` - Enclave Image File
- `enclave-pcr.json` - PCR measurements for attestation

### 2. Run Enclave

```bash
./run-enclave.sh --memory 2048 --cpus 2
```

### 3. Test System

```bash
# Terminal 1: Enclave running (from step 2)

# Terminal 2: Start parent
cd ..
node parent-client.js

# Terminal 3: Test endpoints
curl http://localhost:4000/health
curl http://localhost:4000/v1/health
```

---

## Troubleshooting

### Issue: TypeScript compilation fails

**Check:**
```bash
cd enclave
npm install
npm run build
```

### Issue: Docker build context too large

**Solution:**
Ensure `.dockerignore` excludes unnecessary files:
```
node_modules/
dist/
*.log
.git/
```

### Issue: npm ci fails

**Solution:**
Delete `package-lock.json` and regenerate:
```bash
cd enclave
rm package-lock.json
npm install --package-lock-only
```

### Issue: Permission denied errors

**Check:**
- Build scripts are executable: `chmod +x enclave/*.sh`
- Docker daemon is running: `docker info`

---

## Production Checklist

Before deploying to production:

- [ ] Replace mock MPC with vetted GG20 implementation
- [ ] Implement AWS KMS sealed storage
- [ ] Add remote attestation verification
- [ ] Test in actual AWS Nitro Enclave environment
- [ ] Security audit by cryptographers
- [ ] Load testing (1000+ concurrent requests)
- [ ] Disaster recovery testing
- [ ] Documentation review

---

## References

- [Dockerfile](Dockerfile) - Main Dockerfile
- [enclave/build-eif.sh](enclave/build-eif.sh) - Build script
- [enclave/package.json](enclave/package.json) - Dependencies
- [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) - Project structure
- [API-TEST-EXAMPLES.md](API-TEST-EXAMPLES.md) - API testing guide

---

## Version History

### v1.0.0 (2025-10-13)
- Initial Docker image build
- Fixed ethers v6 compatibility
- Fixed Alpine user/group conflicts
- Added conditional npm install logic
- Successful build: 241MB image
