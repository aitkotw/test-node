# Quick Start Guide

Get up and running with the MPC Two-Party Signing Service in 5 minutes.

## Prerequisites

- Node.js 18 or higher
- npm or yarn

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd test-node

# Install dependencies for parent proxy
npm install

# Install dependencies for enclave
cd enclave
npm install
cd ..
```

## Running Locally (Mock Mode)

The service includes a mock MPC implementation for local testing and development.

### Step 1: Start the Enclave Server

```bash
# Terminal 1
npm run dev:enclave
```

Expected output:
```
[2025-10-13T12:00:00.000Z] [INFO] Enclave server listening on port 5000
[2025-10-13T12:00:00.000Z] [INFO] Mock mode: true
[2025-10-13T12:00:00.000Z] [INFO] Sealed storage: /opt/enclave/sealed
```

### Step 2: Start the Parent Proxy

```bash
# Terminal 2
npm run dev:proxy
```

Expected output:
```
[2025-10-13T12:00:00.000Z] [INFO] Parent proxy listening on port 3000
[2025-10-13T12:00:00.000Z] [INFO] Forwarding to enclave at http://127.0.0.1:5000
[2025-10-13T12:00:00.000Z] [INFO] Rate limit: 100 requests per 900s
```

### Step 3: Test the Service

```bash
# Terminal 3
npm run test:integration
```

Expected output:
```
=================================================
  MPC Two-Party Signing - Integration Tests
=================================================
Proxy URL: http://localhost:3000

=== Checking service health ===
✓ Enclave health: healthy (mockMode: true)

=== Test 1: Account Creation (DKG) ===
✓ Account created successfully
  Account ID: acct-abc123...
  Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb

=== Test 2: Transaction Signing ===
✓ Transaction signed successfully
  Signed TX: 0x02f8...
  ...

=================================================
  ✓ All integration tests passed!
=================================================
```

## Try the Example Client

```bash
node example-client.js
```

This will demonstrate:
1. Creating an account
2. Signing a transaction
3. Signing a message
4. Exporting/importing accounts
5. Backup/recovery (mock)

## Interactive Node.js REPL

```bash
node
```

```javascript
// Import the client SDK
const { MPCClient } = await import('./client-sdk.js');

// Connect to your local service
const client = new MPCClient('http://localhost:3000');

// Create a new account
const account = await client.createAccount('My Wallet');
console.log(`Created account: ${account.address}`);

// Sign a transaction
import { ethers } from 'ethers';

const txParams = {
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: ethers.parseEther('0.1').toString(),
  gasLimit: 21000,
  nonce: 0,
  chainId: 1,
};

const signedTx = await client.signTransaction(account.accountId, txParams);
console.log(`Signed transaction: ${signedTx}`);
```

## API Quick Reference

### Create Account (DKG)

```javascript
const { accountId, address, clientShard } = await client.createAccount('Label');
```

### Sign Transaction

```javascript
const signedTx = await client.signTransaction(accountId, {
  to: '0x...',
  value: '1000000000000000000', // 1 ETH in wei
  gasLimit: 21000,
  nonce: 0,
  chainId: 1,
});
```

### Sign Message Hash

```javascript
import { ethers } from 'ethers';

const message = 'Hello, world!';
const messageHash = ethers.hashMessage(message);
const signature = await client.signHash(accountId, ethers.getBytes(messageHash));
```

### Export/Import Account

```javascript
// Export
const exported = client.exportAccount(accountId);
const json = JSON.stringify(exported);

// Import
const imported = JSON.parse(json);
client.importAccount(imported);
```

### List Accounts

```javascript
const accounts = client.listAccounts();
console.log(accounts);
```

## Environment Variables

### Enclave Server

```bash
PORT=5000                           # HTTP port
MOCK_MPC=true                       # Enable mock mode
KEYSTORE_TYPE=memory                # Use in-memory storage (for dev)
LOG_LEVEL=debug                     # Logging level
```

### Parent Proxy

```bash
PROXY_PORT=3000                     # HTTPS/HTTP port
ENCLAVE_URL=http://127.0.0.1:5000  # Enclave endpoint
LOG_LEVEL=debug                     # Logging level
```

## Troubleshooting

### Error: ECONNREFUSED

The enclave server is not running. Make sure you started it with `npm run dev:enclave`.

### Error: ACCOUNT_NOT_FOUND

You're trying to use an account that doesn't exist. Create a new account first with `client.createAccount()`.

### Error: Cannot find module

Make sure you installed dependencies:
```bash
npm install
cd enclave && npm install
```

### Port already in use

Change the ports:
```bash
PORT=6000 npm run dev:enclave
PROXY_PORT=4000 npm run dev:proxy
```

## Next Steps

1. **Read the full README** - [README.md](README.md)
2. **Review the architecture** - Understand the security model and component interactions
3. **Explore the code**:
   - [enclave/index.ts](enclave/index.ts) - Enclave HTTP server
   - [client-sdk.js](client-sdk.js) - Client SDK
   - [parent-proxy.js](parent-proxy.js) - Parent proxy
4. **Plan production deployment** - Review TODOs in code for production hardening
5. **Replace mock MPC** - Integrate vetted GG20 threshold ECDSA library
6. **Implement sealed storage** - Use AWS KMS or Nitro SDK
7. **Add remote attestation** - Verify enclave integrity

## Production Deployment

For production deployment on AWS Nitro Enclaves, see:
- [README.md - Production Deployment](README.md#production-deployment)
- AWS Nitro Enclaves documentation: https://docs.aws.amazon.com/enclaves/

## Getting Help

- Check the [README.md](README.md) for detailed documentation
- Review [example-client.js](example-client.js) for usage examples
- Run tests: `npm run test:integration`

## Security Warning

**This implementation uses MOCK cryptography for development/testing only.**

**DO NOT use in production without:**
1. Replacing mock MPC with vetted threshold ECDSA
2. Implementing proper sealed storage (AWS KMS/Nitro)
3. Adding remote attestation
4. Security audit by qualified cryptographers

See production TODOs in the code for complete checklist.
