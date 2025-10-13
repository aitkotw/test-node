/**
 * Integration Test for MPC Two-Party Signing Service
 *
 * Tests the complete flow:
 * 1. Account creation (DKG)
 * 2. Transaction signing
 * 3. Message hash signing
 * 4. Account recovery
 *
 * Prerequisites:
 * - Enclave server running on localhost:5000 with MOCK_MPC=true
 * - Parent proxy running on localhost:3000
 *
 * Run: npm run test:integration
 */

import { MPCClient } from './client-sdk.js';
import { ethers } from 'ethers';
import assert from 'assert';

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAccountCreation() {
  console.log('\n=== Test 1: Account Creation (DKG) ===');

  const client = new MPCClient(PROXY_URL);

  const account = await client.createAccount('Test Account');

  assert(account.accountId, 'accountId should be present');
  assert(account.address, 'address should be present');
  assert(account.address.startsWith('0x'), 'address should start with 0x');
  assert(account.address.length === 42, 'address should be 42 characters');
  assert(account.clientShard, 'clientShard should be present');

  console.log(`✓ Account created successfully`);
  console.log(`  Account ID: ${account.accountId}`);
  console.log(`  Address: ${account.address}`);

  return { client, account };
}

async function testTransactionSigning({ client, account }) {
  console.log('\n=== Test 2: Transaction Signing ===');

  const txParams = {
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    value: ethers.parseEther('0.1').toString(),
    gasLimit: 21000,
    maxFeePerGas: ethers.parseUnits('50', 'gwei').toString(),
    maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei').toString(),
    nonce: 0,
    chainId: 1, // Mainnet
  };

  const signedTx = await client.signTransaction(account.accountId, txParams);

  assert(signedTx, 'signedTx should be present');
  assert(signedTx.startsWith('0x'), 'signedTx should start with 0x');

  // Parse and verify signature
  const tx = ethers.Transaction.from(signedTx);
  assert(tx.signature, 'transaction should have signature');
  assert(tx.signature.r, 'signature should have r');
  assert(tx.signature.s, 'signature should have s');

  console.log(`✓ Transaction signed successfully`);
  console.log(`  Signed TX: ${signedTx.slice(0, 66)}...`);
  console.log(`  Signature: r=${tx.signature.r.slice(0, 10)}..., s=${tx.signature.s.slice(0, 10)}..., v=${tx.signature.v}`);

  return { client, account };
}

async function testMessageHashSigning({ client, account }) {
  console.log('\n=== Test 3: Message Hash Signing ===');

  const message = 'Hello, MPC world!';
  const messageHash = ethers.hashMessage(message);
  const messageHashBytes = ethers.getBytes(messageHash);

  const signature = await client.signHash(account.accountId, messageHashBytes);

  assert(signature, 'signature should be present');
  assert(signature.r, 'signature should have r');
  assert(signature.s, 'signature should have s');
  assert(typeof signature.v === 'number', 'signature should have v');

  console.log(`✓ Message hash signed successfully`);
  console.log(`  Message: "${message}"`);
  console.log(`  Hash: ${messageHash}`);
  console.log(`  Signature: r=${signature.r.slice(0, 10)}..., s=${signature.s.slice(0, 10)}..., v=${signature.v}`);

  return { client, account };
}

async function testExportImport({ client, account }) {
  console.log('\n=== Test 4: Export/Import Account ===');

  // Export account
  const exported = client.exportAccount(account.accountId);

  assert(exported.accountId === account.accountId, 'exported accountId should match');
  assert(exported.address === account.address, 'exported address should match');
  assert(exported.clientShard, 'exported clientShard should be present');

  console.log(`✓ Account exported successfully`);

  // Create new client and import
  const client2 = new MPCClient(PROXY_URL);
  client2.importAccount(exported);

  const imported = client2.getAccount(account.accountId);

  assert(imported, 'imported account should exist');
  assert(imported.accountId === account.accountId, 'imported accountId should match');
  assert(imported.address === account.address, 'imported address should match');

  console.log(`✓ Account imported successfully`);

  return { client, account };
}

async function testGetPublicKey({ client, account }) {
  console.log('\n=== Test 5: Get Public Key ===');

  const response = await client._fetch('/v1/getPublicKey', {
    requestId: client._generateRequestId(),
    accountId: account.accountId,
  });

  assert(response.accountId === account.accountId, 'accountId should match');
  assert(response.address === account.address, 'address should match');
  assert(response.publicKey, 'publicKey should be present');

  console.log(`✓ Public key retrieved successfully`);
  console.log(`  Public Key: ${response.publicKey.slice(0, 20)}...`);

  return { client, account };
}

async function testRecovery({ client, account }) {
  console.log('\n=== Test 6: Recovery (Mock) ===');

  // In mock mode, we simulate recovery by calling the recover endpoint
  const clientMessage = JSON.stringify({
    type: 'recovery_challenge',
    data: Buffer.from('mock-challenge').toString('hex'),
  });

  const response = await client._fetch('/v1/recover/start', {
    requestId: client._generateRequestId(),
    accountId: account.accountId,
    clientMessage: Buffer.from(clientMessage).toString('base64'),
  });

  assert(response.status === 'DONE', 'recovery should complete');
  assert(response.address === account.address, 'recovered address should match');

  console.log(`✓ Recovery verified successfully`);
  console.log(`  Recovered Address: ${response.address}`);

  return { client, account };
}

async function testMultipleAccounts() {
  console.log('\n=== Test 7: Multiple Accounts ===');

  const client = new MPCClient(PROXY_URL);

  // Create 3 accounts
  const accounts = [];
  for (let i = 0; i < 3; i++) {
    const account = await client.createAccount(`Account ${i + 1}`);
    accounts.push(account);
    console.log(`  Created account ${i + 1}: ${account.address}`);
  }

  // List all accounts
  const list = client.listAccounts();
  assert(list.length === 3, 'should have 3 accounts');

  console.log(`✓ Multiple accounts created and listed successfully`);

  // Sign with each account
  for (const account of accounts) {
    const messageHash = ethers.randomBytes(32);
    const signature = await client.signHash(account.accountId, messageHash);
    assert(signature.r && signature.s, `account ${account.accountId} should sign`);
  }

  console.log(`✓ All accounts can sign independently`);

  return { client, accounts };
}

async function testErrorHandling() {
  console.log('\n=== Test 8: Error Handling ===');

  const client = new MPCClient(PROXY_URL);

  // Test 1: Sign with non-existent account
  try {
    await client.signHash('invalid-account-id', ethers.randomBytes(32));
    assert.fail('Should have thrown error for invalid account');
  } catch (err) {
    assert(err.message.includes('Account invalid-account-id not found'), 'should error for invalid account');
    console.log(`✓ Correctly handles invalid account: ${err.message}`);
  }

  // Test 2: Get public key for non-existent account
  try {
    await client._fetch('/v1/getPublicKey', {
      accountId: 'non-existent-account',
    });
    assert.fail('Should have thrown error for non-existent account');
  } catch (err) {
    assert(err.message.includes('ACCOUNT_NOT_FOUND'), 'should return ACCOUNT_NOT_FOUND error');
    console.log(`✓ Correctly handles non-existent account: ${err.message}`);
  }

  // Test 3: Invalid session
  try {
    await client._fetch('/v1/createAccount/step', {
      sessionId: 'invalid-session-id',
      clientMessage: Buffer.from('test').toString('base64'),
    });
    assert.fail('Should have thrown error for invalid session');
  } catch (err) {
    assert(err.message.includes('INVALID_SESSION'), 'should return INVALID_SESSION error');
    console.log(`✓ Correctly handles invalid session: ${err.message}`);
  }

  console.log(`✓ Error handling tests passed`);
}

async function runAllTests() {
  console.log('=================================================');
  console.log('  MPC Two-Party Signing - Integration Tests');
  console.log('=================================================');
  console.log(`Proxy URL: ${PROXY_URL}`);

  try {
    // Test connection
    console.log('\n=== Checking service health ===');
    const client = new MPCClient(PROXY_URL);
    const health = await fetch(`${PROXY_URL}/v1/health`).then(r => r.json());
    console.log(`✓ Enclave health: ${health.status} (mockMode: ${health.mockMode})`);

    // Run tests in sequence
    let context = await testAccountCreation();
    context = await testTransactionSigning(context);
    context = await testMessageHashSigning(context);
    context = await testExportImport(context);
    context = await testGetPublicKey(context);
    context = await testRecovery(context);

    await testMultipleAccounts();
    await testErrorHandling();

    console.log('\n=================================================');
    console.log('  ✓ All integration tests passed!');
    console.log('=================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
