/**
 * Example Client Usage
 *
 * Demonstrates how to use the MPCClient SDK for common operations:
 * - Creating an account
 * - Signing transactions
 * - Backing up to Google Drive
 * - Recovering from backup
 *
 * Run: node example-client.js
 */

import { MPCClient } from './client-sdk.js';
import { ethers } from 'ethers';

// Configuration
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3000';

async function main() {
  console.log('=== MPC Two-Party Signing - Example Client ===\n');

  // Initialize client
  const client = new MPCClient(PROXY_URL);

  // ==========================================================================
  // 1. Create Account (Distributed Key Generation)
  // ==========================================================================

  console.log('1. Creating new account with distributed key generation...');

  const { accountId, address, clientShard } = await client.createAccount('My Wallet');

  console.log(`✓ Account created!`);
  console.log(`  Account ID: ${accountId}`);
  console.log(`  Address: ${address}`);
  console.log(`  Client shard stored locally (${clientShard.length} bytes)\n`);

  // ==========================================================================
  // 2. Sign an Ethereum Transaction
  // ==========================================================================

  console.log('2. Signing an Ethereum transaction...');

  // Build transaction parameters
  const txParams = {
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    value: ethers.parseEther('0.1').toString(), // 0.1 ETH
    gasLimit: 21000,
    maxFeePerGas: ethers.parseUnits('50', 'gwei').toString(),
    maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei').toString(),
    nonce: 0,
    chainId: 1, // Ethereum mainnet
  };

  const signedTx = await client.signTransaction(accountId, txParams);

  console.log(`✓ Transaction signed!`);
  console.log(`  Signed TX: ${signedTx}`);

  // Parse transaction to show details
  const tx = ethers.Transaction.from(signedTx);
  console.log(`  To: ${tx.to}`);
  console.log(`  Value: ${ethers.formatEther(tx.value)} ETH`);
  console.log(`  Signature: r=${tx.signature.r.slice(0, 10)}..., s=${tx.signature.s.slice(0, 10)}..., v=${tx.signature.v}\n`);

  // In production, broadcast the transaction:
  // const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY');
  // const receipt = await provider.broadcastTransaction(signedTx);
  // console.log(`  Transaction hash: ${receipt.hash}`);

  // ==========================================================================
  // 3. Sign a Message Hash (for general-purpose signing)
  // ==========================================================================

  console.log('3. Signing a message hash...');

  const message = 'Hello from MPC two-party signing!';
  const messageHash = ethers.hashMessage(message);
  const messageHashBytes = ethers.getBytes(messageHash);

  const signature = await client.signHash(accountId, messageHashBytes);

  console.log(`✓ Message signed!`);
  console.log(`  Message: "${message}"`);
  console.log(`  Hash: ${messageHash}`);
  console.log(`  Signature: { r: ${signature.r.slice(0, 10)}..., s: ${signature.s.slice(0, 10)}..., v: ${signature.v} }\n`);

  // Verify signature (reconstruct full signature for verification)
  const fullSig = ethers.Signature.from({
    r: '0x' + signature.r,
    s: '0x' + signature.s,
    v: signature.v,
  });
  const recoveredAddress = ethers.recoverAddress(messageHash, fullSig);
  console.log(`  Verified: Recovered address ${recoveredAddress}`);
  console.log(`  Match: ${recoveredAddress.toLowerCase() === address.toLowerCase() ? '✓' : '✗'}\n`);

  // ==========================================================================
  // 4. Export Account (for local backup)
  // ==========================================================================

  console.log('4. Exporting account for backup...');

  const exported = client.exportAccount(accountId);

  console.log(`✓ Account exported!`);
  console.log(`  Data: ${JSON.stringify(exported, null, 2).slice(0, 200)}...\n`);

  // Save to file:
  // import fs from 'fs';
  // fs.writeFileSync('backup.json', JSON.stringify(exported, null, 2));

  // ==========================================================================
  // 5. Import Account (from backup)
  // ==========================================================================

  console.log('5. Importing account from backup...');

  // Simulate a new client instance
  const client2 = new MPCClient(PROXY_URL);
  client2.importAccount(exported);

  const imported = client2.getAccount(accountId);
  console.log(`✓ Account imported!`);
  console.log(`  Account ID: ${imported.accountId}`);
  console.log(`  Address: ${imported.address}\n`);

  // ==========================================================================
  // 6. List All Accounts
  // ==========================================================================

  console.log('6. Listing all accounts...');

  const accounts = client.listAccounts();
  console.log(`✓ Found ${accounts.length} account(s):`);
  accounts.forEach((acc, i) => {
    console.log(`  ${i + 1}. ${acc.address} (${acc.label || 'No label'})`);
  });
  console.log();

  // ==========================================================================
  // 7. Google Drive Backup (Mock)
  // ==========================================================================

  console.log('7. Backing up to Google Drive (mock)...');
  console.log('   Note: This is a mock implementation for demonstration.');
  console.log('   In production, implement real Google OAuth flow.\n');

  try {
    // Mock OAuth token and passphrase
    const mockOAuthToken = 'mock-oauth-token';
    const passphrase = 'strong-user-passphrase-123';

    await client.backupToGoogle(accountId, passphrase, mockOAuthToken);

    console.log(`✓ Backup to Google Drive complete!\n`);

    // ==========================================================================
    // 8. Recovery from Google Drive (Mock)
    // ==========================================================================

    console.log('8. Recovering from Google Drive (mock)...');

    // Simulate a new client that doesn't have the account
    const client3 = new MPCClient(PROXY_URL);

    const recovered = await client3.recoverFromGoogle(accountId, passphrase, mockOAuthToken);

    console.log(`✓ Account recovered!`);
    console.log(`  Account ID: ${recovered.accountId}`);
    console.log(`  Address: ${recovered.address}\n`);

    // Verify recovered account can sign
    const testHash = ethers.randomBytes(32);
    const testSig = await client3.signHash(accountId, testHash);
    console.log(`✓ Recovered account can sign: { r: ${testSig.r.slice(0, 10)}..., s: ${testSig.s.slice(0, 10)}..., v: ${testSig.v} }\n`);

  } catch (err) {
    console.log(`Note: Google Drive backup/recovery requires browser environment or mock storage`);
    console.log(`Error: ${err.message}\n`);
  }

  // ==========================================================================
  // Summary
  // ==========================================================================

  console.log('=== Example Complete ===');
  console.log('All operations completed successfully!\n');
  console.log('Next steps:');
  console.log('1. Replace mock MPC with vetted GG20 implementation');
  console.log('2. Implement proper sealed storage (AWS KMS/Nitro)');
  console.log('3. Add remote attestation verification');
  console.log('4. Implement real Google OAuth flow');
  console.log('5. Deploy to AWS Nitro Enclave\n');
}

// Run example
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
