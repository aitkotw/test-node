/**
 * KeyStore implementations for server shard storage
 *
 * PRODUCTION TODO: Replace FileSealedKeyStore with proper AWS Nitro Enclave
 * sealing APIs or AWS KMS-backed encryption. The current file-based approach
 * is for development only and does NOT provide cryptographic sealing.
 *
 * AWS Nitro Enclaves: Use KMS Decrypt with attestation document
 * Reference: https://docs.aws.amazon.com/enclaves/latest/user/kms.html
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { KeyStore, AccountMetadata } from './types.js';

// ============================================================================
// FileSealedKeyStore - File-based storage with placeholder sealing
// ============================================================================

export class FileSealedKeyStore implements KeyStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });
      // Ensure the directory has restricted permissions
      await fs.chmod(this.basePath, 0o700);
    } catch (err) {
      throw new Error(`Failed to initialize keystore at ${this.basePath}: ${err}`);
    }
  }

  /**
   * PRODUCTION TODO: Replace with AWS Nitro sealing or KMS encryption
   *
   * Current implementation uses file system with mode 0600 which provides
   * OS-level protection but NOT cryptographic sealing against root access
   * or physical attacks.
   *
   * Required changes:
   * 1. Use AWS KMS Encrypt with enclave attestation document
   * 2. Store encrypted blob to disk
   * 3. On load, use KMS Decrypt (requires valid attestation)
   * 4. Consider using AWS Secrets Manager with attestation-based access
   */
  async persistServerShard(accountId: string, serverShard: Uint8Array | string): Promise<void> {
    this.validateAccountId(accountId);

    const shardPath = this.getShardPath(accountId);

    // Convert to Buffer if Uint8Array
    const data = typeof serverShard === 'string'
      ? Buffer.from(serverShard, 'base64')
      : Buffer.from(serverShard);

    try {
      // TODO: Add encryption before writing to disk
      // Example: const encrypted = await kmsEncrypt(data, attestationDoc);
      await fs.writeFile(shardPath, data, { mode: 0o600 });

      // Double-check permissions were set correctly
      await fs.chmod(shardPath, 0o600);
    } catch (err) {
      throw new Error(`KEYSTORE_ERROR: Failed to persist shard for ${accountId}: ${err}`);
    }
  }

  async loadServerShard(accountId: string): Promise<Uint8Array> {
    this.validateAccountId(accountId);

    const shardPath = this.getShardPath(accountId);

    try {
      const data = await fs.readFile(shardPath);

      // TODO: Add decryption after reading from disk
      // Example: const decrypted = await kmsDecrypt(data, attestationDoc);

      return new Uint8Array(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`ACCOUNT_NOT_FOUND: No shard found for ${accountId}`);
      }
      throw new Error(`KEYSTORE_ERROR: Failed to load shard for ${accountId}: ${err}`);
    }
  }

  async has(accountId: string): Promise<boolean> {
    this.validateAccountId(accountId);

    try {
      const shardPath = this.getShardPath(accountId);
      await fs.access(shardPath);
      return true;
    } catch {
      return false;
    }
  }

  async persistAccountMetadata(accountId: string, metadata: AccountMetadata): Promise<void> {
    this.validateAccountId(accountId);

    const metadataPath = this.getMetadataPath(accountId);

    try {
      // Metadata is non-secret and can be stored as JSON
      const json = JSON.stringify(metadata, null, 2);
      await fs.writeFile(metadataPath, json, { mode: 0o600 });
    } catch (err) {
      throw new Error(`KEYSTORE_ERROR: Failed to persist metadata for ${accountId}: ${err}`);
    }
  }

  async loadAccountMetadata(accountId: string): Promise<AccountMetadata> {
    this.validateAccountId(accountId);

    const metadataPath = this.getMetadataPath(accountId);

    try {
      const json = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(json);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`ACCOUNT_NOT_FOUND: No metadata found for ${accountId}`);
      }
      throw new Error(`KEYSTORE_ERROR: Failed to load metadata for ${accountId}: ${err}`);
    }
  }

  async listAccounts(): Promise<Array<{ accountId: string; address: string }>> {
    try {
      const files = await fs.readdir(this.basePath);
      const metadataFiles = files.filter(f => f.endsWith('.meta.json'));

      const accounts: Array<{ accountId: string; address: string }> = [];

      for (const file of metadataFiles) {
        const accountId = file.replace('.meta.json', '');
        try {
          const metadata = await this.loadAccountMetadata(accountId);
          accounts.push({ accountId: metadata.accountId, address: metadata.address });
        } catch {
          // Skip corrupted metadata
          continue;
        }
      }

      return accounts;
    } catch (err) {
      throw new Error(`KEYSTORE_ERROR: Failed to list accounts: ${err}`);
    }
  }

  // Private helpers

  private getShardPath(accountId: string): string {
    return path.join(this.basePath, `${accountId}.shard`);
  }

  private getMetadataPath(accountId: string): string {
    return path.join(this.basePath, `${accountId}.meta.json`);
  }

  private validateAccountId(accountId: string): void {
    // Prevent path traversal attacks
    if (!accountId || accountId.includes('/') || accountId.includes('\\') || accountId.includes('..')) {
      throw new Error('INVALID_REQUEST: Invalid accountId format');
    }
  }
}

// ============================================================================
// InMemoryKeyStore - For development and testing
// ============================================================================

export class InMemoryKeyStore implements KeyStore {
  private shards: Map<string, Uint8Array> = new Map();
  private metadata: Map<string, AccountMetadata> = new Map();

  async initialize(): Promise<void> {
    // No-op for in-memory store
  }

  async persistServerShard(accountId: string, serverShard: Uint8Array | string): Promise<void> {
    const data = typeof serverShard === 'string'
      ? Buffer.from(serverShard, 'base64')
      : serverShard;

    this.shards.set(accountId, new Uint8Array(data));
  }

  async loadServerShard(accountId: string): Promise<Uint8Array> {
    const shard = this.shards.get(accountId);
    if (!shard) {
      throw new Error(`ACCOUNT_NOT_FOUND: No shard found for ${accountId}`);
    }
    // Return a copy to prevent external mutation
    return new Uint8Array(shard);
  }

  async has(accountId: string): Promise<boolean> {
    return this.shards.has(accountId);
  }

  async persistAccountMetadata(accountId: string, metadata: AccountMetadata): Promise<void> {
    this.metadata.set(accountId, { ...metadata });
  }

  async loadAccountMetadata(accountId: string): Promise<AccountMetadata> {
    const meta = this.metadata.get(accountId);
    if (!meta) {
      throw new Error(`ACCOUNT_NOT_FOUND: No metadata found for ${accountId}`);
    }
    return { ...meta };
  }

  async listAccounts(): Promise<Array<{ accountId: string; address: string }>> {
    return Array.from(this.metadata.values()).map(m => ({
      accountId: m.accountId,
      address: m.address,
    }));
  }

  /**
   * Clear all stored data (testing only)
   */
  clear(): void {
    this.shards.clear();
    this.metadata.clear();
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createKeyStore(config: { type: 'file' | 'memory'; basePath?: string }): KeyStore {
  if (config.type === 'memory') {
    return new InMemoryKeyStore();
  } else {
    if (!config.basePath) {
      throw new Error('basePath required for file-based keystore');
    }
    return new FileSealedKeyStore(config.basePath);
  }
}
