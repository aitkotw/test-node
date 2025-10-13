/**
 * MPC Two-Party Signing Client SDK
 *
 * Runs on user's device (browser or Node.js). Participates as the second
 * MPC party, communicating with enclave via parent-proxy over HTTPS.
 *
 * Features:
 * - Interactive DKG (key generation)
 * - Interactive MPC signing
 * - Google OAuth backup/recovery of client shard
 * - Local client shard storage
 * - Transaction building and signature assembly
 *
 * SECURITY NOTES:
 * - Client shard must be stored securely (OS keystore, encrypted storage)
 * - Google OAuth used only for encrypted backup storage
 * - Backup encryption key derived from user passphrase or stored in OS keystore
 * - Never send unencrypted client shard over network
 *
 * PRODUCTION TODOS:
 * - Replace mock MPC client with vetted GG20 implementation
 * - Implement secure client shard storage (Web Crypto API, keychain, etc.)
 * - Add proper error handling and retry logic
 * - Implement Google OAuth flow with proper token refresh
 * - Add UI/UX for passphrase entry and backup management
 * - Audit encryption parameters (use Argon2 for KDF, AES-256-GCM)
 */

import { ethers } from 'ethers';
import crypto from 'crypto'; // For Node.js; use Web Crypto API in browser

// ============================================================================
// Configuration
// ============================================================================

const MOCK_MODE = process.env.MOCK_MPC === 'true' || true; // Enable mock mode by default

// ============================================================================
// MPCClient - Main SDK Class
// ============================================================================

export class MPCClient {
  /**
   * @param {string} proxyUrl - URL of parent-proxy (e.g., https://ec2-host.amazonaws.com)
   */
  constructor(proxyUrl) {
    this.proxyUrl = proxyUrl;
    this.accounts = new Map(); // accountId -> { accountId, address, clientShard }
  }

  // ==========================================================================
  // Account Creation (DKG)
  // ==========================================================================

  /**
   * Create a new account using distributed key generation
   *
   * @param {string} [label] - Optional label for the account
   * @returns {Promise<{accountId: string, address: string, clientShard: Uint8Array}>}
   */
  async createAccount(label) {
    console.log('[MPCClient] Starting account creation (DKG)...');

    // Step 1: Start DKG
    const startResponse = await this._fetch('/v1/createAccount/start', {
      requestId: this._generateRequestId(),
      label,
      clientNodeId: 'client-node-1',
    });

    let sessionId = startResponse.sessionId;
    let serverMessage = Buffer.from(startResponse.serverMessage, 'base64');

    // Step 2: Client initializes DKG
    let clientState = this._mockClientDKGStart(serverMessage);

    // Step 3: Multi-round exchange
    let done = false;
    let accountId;
    let address;

    while (!done) {
      const clientMessage = this._mockClientDKGStep(clientState, serverMessage);

      const stepResponse = await this._fetch('/v1/createAccount/step', {
        requestId: this._generateRequestId(),
        sessionId,
        clientMessage: Buffer.from(clientMessage).toString('base64'),
      });

      if (stepResponse.status === 'DONE') {
        done = true;
        accountId = stepResponse.accountId;
        address = stepResponse.address;
        console.log(`[MPCClient] DKG complete: accountId=${accountId}, address=${address}`);
      } else {
        // Continue to next round
        serverMessage = Buffer.from(stepResponse.serverMessage, 'base64');
        clientState = this._mockClientDKGAdvance(clientState);
      }
    }

    // Step 4: Store client shard locally
    const clientShard = clientState.clientShard;

    this.accounts.set(accountId, {
      accountId,
      address,
      clientShard,
      label,
      createdAt: new Date().toISOString(),
    });

    console.log('[MPCClient] Client shard stored locally');

    return { accountId, address, clientShard };
  }

  // ==========================================================================
  // Signing
  // ==========================================================================

  /**
   * Sign an Ethereum transaction
   *
   * @param {string} accountId - Account to sign with
   * @param {object} txParams - Transaction parameters (to, value, data, gasLimit, etc.)
   * @returns {Promise<string>} - Signed transaction hex (ready to broadcast)
   */
  async signTransaction(accountId, txParams) {
    console.log(`[MPCClient] Signing transaction for account ${accountId}`);

    // Step 1: Build transaction and compute digest
    const tx = await this._buildTransaction(txParams);
    const digest = ethers.keccak256(ethers.Transaction.from(tx).unsignedSerialized);
    const digestBytes = ethers.getBytes(digest);

    console.log(`[MPCClient] Transaction digest: ${digest}`);

    // Step 2: Start signing protocol
    const clientMessage = JSON.stringify({
      messageHash: Buffer.from(digestBytes).toString('hex'),
      round: 1,
    });

    const startResponse = await this._fetch('/v1/sign/start', {
      requestId: this._generateRequestId(),
      accountId,
      clientMessage: Buffer.from(clientMessage).toString('base64'),
    });

    let sessionId = startResponse.sessionId;
    let serverMessage = Buffer.from(startResponse.serverMessage, 'base64');

    // Step 3: Client prepares signing
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found. Call createAccount first.`);
    }

    let clientState = this._mockClientSignStart(account.clientShard, digestBytes, serverMessage);

    // Step 4: Exchange signing messages
    let done = false;
    let serverPartial;

    while (!done) {
      const clientMsg = this._mockClientSignStep(clientState, serverMessage);

      const stepResponse = await this._fetch('/v1/sign/step', {
        requestId: this._generateRequestId(),
        sessionId,
        clientMessage: Buffer.from(clientMsg).toString('base64'),
      });

      if (stepResponse.status === 'DONE') {
        done = true;
        serverPartial = Buffer.from(stepResponse.serverPartial, 'base64');
        console.log('[MPCClient] MPC signing complete');
      } else {
        serverMessage = Buffer.from(stepResponse.serverMessage, 'base64');
      }
    }

    // Step 5: Assemble final signature from server partial + client partial
    const signature = this._mockAssembleSignature(serverPartial, clientState);

    console.log(`[MPCClient] Signature: r=${signature.r}, s=${signature.s}, v=${signature.v}`);

    // Step 6: Serialize signed transaction
    const signedTx = ethers.Transaction.from({
      ...tx,
      signature: {
        r: '0x' + signature.r,
        s: '0x' + signature.s,
        v: signature.v,
      },
    });

    const serialized = signedTx.serialized;
    console.log(`[MPCClient] Signed transaction: ${serialized}`);

    return serialized;
  }

  /**
   * Sign a raw message hash (for general-purpose signing)
   *
   * @param {string} accountId
   * @param {Uint8Array} messageHash - 32-byte hash to sign
   * @returns {Promise<{r: string, s: string, v: number}>}
   */
  async signHash(accountId, messageHash) {
    console.log(`[MPCClient] Signing hash for account ${accountId}`);

    const clientMessage = JSON.stringify({
      messageHash: Buffer.from(messageHash).toString('hex'),
      round: 1,
    });

    const startResponse = await this._fetch('/v1/sign/start', {
      requestId: this._generateRequestId(),
      accountId,
      clientMessage: Buffer.from(clientMessage).toString('base64'),
    });

    let sessionId = startResponse.sessionId;
    let serverMessage = Buffer.from(startResponse.serverMessage, 'base64');

    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    let clientState = this._mockClientSignStart(account.clientShard, messageHash, serverMessage);

    let done = false;
    let serverPartial;

    while (!done) {
      const clientMsg = this._mockClientSignStep(clientState, serverMessage);

      const stepResponse = await this._fetch('/v1/sign/step', {
        requestId: this._generateRequestId(),
        sessionId,
        clientMessage: Buffer.from(clientMsg).toString('base64'),
      });

      if (stepResponse.status === 'DONE') {
        done = true;
        serverPartial = Buffer.from(stepResponse.serverPartial, 'base64');
      } else {
        serverMessage = Buffer.from(stepResponse.serverMessage, 'base64');
      }
    }

    const signature = this._mockAssembleSignature(serverPartial, clientState);

    return signature;
  }

  // ==========================================================================
  // Backup & Recovery (Google OAuth)
  // ==========================================================================

  /**
   * Backup client shard to Google Drive (encrypted)
   *
   * @param {string} accountId
   * @param {string} passphrase - User passphrase for encryption
   * @param {string} oauthToken - Google OAuth access token
   * @returns {Promise<void>}
   */
  async backupToGoogle(accountId, passphrase, oauthToken) {
    console.log(`[MPCClient] Backing up account ${accountId} to Google Drive`);

    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Step 1: Derive encryption key from passphrase
    const encryptionKey = await this._deriveEncryptionKey(passphrase, accountId);

    // Step 2: Encrypt client shard
    const encrypted = await this._encryptShard(account.clientShard, encryptionKey);

    // Step 3: Upload to Google Drive
    await this._uploadToGoogleDrive(oauthToken, accountId, encrypted);

    console.log('[MPCClient] Backup complete');
  }

  /**
   * Recover client shard from Google Drive
   *
   * @param {string} accountId
   * @param {string} passphrase
   * @param {string} oauthToken
   * @returns {Promise<{accountId: string, address: string}>}
   */
  async recoverFromGoogle(accountId, passphrase, oauthToken) {
    console.log(`[MPCClient] Recovering account ${accountId} from Google Drive`);

    // Step 1: Download encrypted shard from Google Drive
    const encrypted = await this._downloadFromGoogleDrive(oauthToken, accountId);

    // Step 2: Derive encryption key
    const encryptionKey = await this._deriveEncryptionKey(passphrase, accountId);

    // Step 3: Decrypt client shard
    const clientShard = await this._decryptShard(encrypted, encryptionKey);

    // Step 4: Verify with enclave (recovery handshake)
    const clientMessage = JSON.stringify({
      type: 'recovery_challenge',
      data: crypto.randomBytes(32).toString('hex'),
    });

    const response = await this._fetch('/v1/recover/start', {
      requestId: this._generateRequestId(),
      accountId,
      clientMessage: Buffer.from(clientMessage).toString('base64'),
    });

    if (response.status === 'DONE') {
      // Recovery successful
      this.accounts.set(accountId, {
        accountId,
        address: response.address,
        clientShard,
        recoveredAt: new Date().toISOString(),
      });

      console.log(`[MPCClient] Recovery complete: address=${response.address}`);

      return { accountId, address: response.address };
    } else {
      throw new Error('Recovery verification failed');
    }
  }

  // ==========================================================================
  // Account Management
  // ==========================================================================

  /**
   * Get account info
   */
  getAccount(accountId) {
    return this.accounts.get(accountId);
  }

  /**
   * List all local accounts
   */
  listAccounts() {
    return Array.from(this.accounts.values()).map(a => ({
      accountId: a.accountId,
      address: a.address,
      label: a.label,
      createdAt: a.createdAt,
    }));
  }

  /**
   * Export account (for backup to file, etc.)
   */
  exportAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    return {
      accountId: account.accountId,
      address: account.address,
      clientShard: Buffer.from(account.clientShard).toString('base64'),
      label: account.label,
      createdAt: account.createdAt,
    };
  }

  /**
   * Import account (from file backup, etc.)
   */
  importAccount(accountData) {
    this.accounts.set(accountData.accountId, {
      accountId: accountData.accountId,
      address: accountData.address,
      clientShard: Buffer.from(accountData.clientShard, 'base64'),
      label: accountData.label,
      createdAt: accountData.createdAt,
      importedAt: new Date().toISOString(),
    });

    console.log(`[MPCClient] Imported account ${accountData.accountId}`);
  }

  // ==========================================================================
  // Private Helpers - Network
  // ==========================================================================

  async _fetch(endpoint, body) {
    const url = `${this.proxyUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(`API Error: ${json.error?.code} - ${json.error?.message}`);
    }

    return json;
  }

  _generateRequestId() {
    return `req-${crypto.randomBytes(8).toString('hex')}`;
  }

  // ==========================================================================
  // Private Helpers - Mock MPC Client Implementation
  // ==========================================================================

  /**
   * PRODUCTION TODO: Replace with real GG20 client implementation
   *
   * Mock DKG client - simulates multi-round key generation
   */
  _mockClientDKGStart(serverMessage) {
    // In mock mode, client generates its own full private key
    const clientPrivateKey = crypto.randomBytes(32);

    return {
      round: 1,
      clientPrivateKey,
      clientShard: clientPrivateKey, // Mock: client's "share" is the full key
    };
  }

  _mockClientDKGStep(clientState, serverMessage) {
    // Return a mock client message
    const message = {
      round: clientState.round,
      type: 'dkg_client_message',
      data: crypto.randomBytes(32),
    };

    return Buffer.from(JSON.stringify(message));
  }

  _mockClientDKGAdvance(clientState) {
    return {
      ...clientState,
      round: clientState.round + 1,
    };
  }

  /**
   * Mock signing client
   */
  _mockClientSignStart(clientShard, messageHash, serverMessage) {
    return {
      clientShard,
      messageHash,
      round: 1,
    };
  }

  _mockClientSignStep(clientState, serverMessage) {
    const message = {
      round: clientState.round,
      type: 'sign_client_message',
      data: crypto.randomBytes(32),
    };

    return Buffer.from(JSON.stringify(message));
  }

  /**
   * Assemble final signature from server partial and client state
   *
   * In mock mode, server returns full signature as "partial"
   */
  _mockAssembleSignature(serverPartial, clientState) {
    // Mock: server partial is actually the full signature (r, s, v)
    const r = serverPartial.slice(0, 32).toString('hex');
    const s = serverPartial.slice(32, 64).toString('hex');
    const v = serverPartial[64];

    return { r, s, v };
  }

  // ==========================================================================
  // Private Helpers - Transaction Building
  // ==========================================================================

  async _buildTransaction(txParams) {
    // Build unsigned transaction
    // Support both legacy and EIP-1559

    const tx = {
      to: txParams.to,
      value: txParams.value || 0,
      data: txParams.data || '0x',
      nonce: txParams.nonce,
      chainId: txParams.chainId || 1,
    };

    if (txParams.gasLimit) {
      tx.gasLimit = txParams.gasLimit;
    }

    // EIP-1559 (if provided)
    if (txParams.maxFeePerGas) {
      tx.maxFeePerGas = txParams.maxFeePerGas;
      tx.maxPriorityFeePerGas = txParams.maxPriorityFeePerGas || txParams.maxFeePerGas;
      tx.type = 2;
    } else if (txParams.gasPrice) {
      tx.gasPrice = txParams.gasPrice;
      tx.type = 0;
    }

    return tx;
  }

  // ==========================================================================
  // Private Helpers - Encryption & Google OAuth
  // ==========================================================================

  /**
   * Derive encryption key from passphrase
   *
   * PRODUCTION TODO: Use Argon2 or scrypt with proper parameters
   * Current: PBKDF2 for compatibility
   */
  async _deriveEncryptionKey(passphrase, salt) {
    // Use Node.js crypto (replace with Web Crypto API in browser)
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(passphrase, salt, 100000, 32, 'sha256', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  /**
   * Encrypt client shard with AES-256-GCM
   */
  async _encryptShard(clientShard, encryptionKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(clientShard)),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  /**
   * Decrypt client shard
   */
  async _decryptShard(encrypted, encryptionKey) {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return new Uint8Array(decrypted);
  }

  /**
   * Upload to Google Drive
   *
   * PRODUCTION TODO: Implement actual Google Drive API calls
   * Use Google Drive API v3 with resumable uploads
   */
  async _uploadToGoogleDrive(oauthToken, accountId, encryptedData) {
    console.log('[MPCClient] Uploading to Google Drive (mock)');

    // Mock implementation - in production, use Google Drive API:
    // POST https://www.googleapis.com/upload/drive/v3/files
    // Authorization: Bearer {oauthToken}
    // Body: file metadata + encrypted data

    // Store in local mock storage for testing
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        `mpc-backup-${accountId}`,
        JSON.stringify(encryptedData)
      );
    }

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[MPCClient] Upload complete (mock)');
  }

  /**
   * Download from Google Drive
   *
   * PRODUCTION TODO: Implement actual Google Drive API calls
   */
  async _downloadFromGoogleDrive(oauthToken, accountId) {
    console.log('[MPCClient] Downloading from Google Drive (mock)');

    // Mock implementation - in production, use Google Drive API:
    // GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
    // Authorization: Bearer {oauthToken}

    // Retrieve from local mock storage
    if (typeof window !== 'undefined' && window.localStorage) {
      const data = window.localStorage.getItem(`mpc-backup-${accountId}`);
      if (!data) {
        throw new Error('Backup not found in Google Drive');
      }
      return JSON.parse(data);
    }

    throw new Error('Mock storage not available');
  }
}

// ============================================================================
// Exports
// ============================================================================

export default MPCClient;

/**
 * PRODUCTION DEPLOYMENT CHECKLIST:
 *
 * 1. MPC Client Implementation:
 *    - Replace mock MPC functions with real GG20 client
 *    - Use vetted cryptographic libraries
 *    - Implement proper error handling for protocol failures
 *
 * 2. Secure Storage:
 *    - Browser: Use IndexedDB with encryption, or Web Crypto API
 *    - Mobile: Use OS keychain (iOS Keychain, Android Keystore)
 *    - Desktop: Use OS credential manager
 *
 * 3. Encryption:
 *    - Use Argon2 or scrypt for KDF (PBKDF2 is minimum)
 *    - Recommended Argon2id parameters: memory=64MB, iterations=3, parallelism=1
 *    - Always use AES-256-GCM with random IV
 *
 * 4. Google OAuth:
 *    - Implement proper OAuth 2.0 flow (authorization code with PKCE)
 *    - Handle token refresh
 *    - Use Google Drive API v3 for file upload/download
 *    - Store files in application data folder (not visible to user)
 *    - Add file versioning for backup history
 *
 * 5. Error Handling:
 *    - Retry logic with exponential backoff
 *    - User-friendly error messages
 *    - Distinguish recoverable vs non-recoverable errors
 *
 * 6. UI/UX:
 *    - Progress indicators for DKG and signing
 *    - Clear backup/recovery instructions
 *    - Passphrase strength meter
 *    - Option to download encrypted backup file
 *
 * 7. Testing:
 *    - Unit tests for encryption/decryption
 *    - Integration tests for full DKG and signing flows
 *    - Test recovery with incorrect passphrase
 *    - Test concurrent signing sessions
 */
