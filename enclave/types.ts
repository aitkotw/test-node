/**
 * Type definitions for MPC-based two-party signing service
 *
 * Security note: All types that carry cryptographic material should be
 * properly cleared from memory after use in production.
 */

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface BaseRequest {
  requestId?: string;
}

export interface BaseResponse {
  requestId?: string;
}

export interface ErrorResponse extends BaseResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_SESSION'
  | 'ACCOUNT_NOT_FOUND'
  | 'KEYSTORE_ERROR'
  | 'MPC_ERROR'
  | 'MPC_TIMEOUT'
  | 'MPC_PARTY_MISSING'
  | 'MPC_INVALID_SHARE'
  | 'SIGNING_ERROR'
  | 'RECOVERY_FAILED'
  | 'INTERNAL_ERROR';

// ============================================================================
// CreateAccount Endpoints
// ============================================================================

export interface CreateAccountStartRequest extends BaseRequest {
  label?: string;
  clientNodeId?: string;
}

export interface CreateAccountStartResponse extends BaseResponse {
  sessionId: string;
  serverMessage: string; // base64 encoded MPC message
}

export interface CreateAccountStepRequest extends BaseRequest {
  sessionId: string;
  clientMessage: string; // base64 encoded MPC message
}

export interface CreateAccountStepResponse extends BaseResponse {
  sessionId: string;
  status: 'CONTINUE' | 'DONE';
  serverMessage?: string; // base64 encoded, present if status is CONTINUE
  accountId?: string; // present if status is DONE
  address?: string; // Ethereum address, present if status is DONE
}

// ============================================================================
// GetPublicKey Endpoint
// ============================================================================

export interface GetPublicKeyRequest extends BaseRequest {
  accountId: string;
}

export interface GetPublicKeyResponse extends BaseResponse {
  accountId: string;
  address: string;
  publicKey: string; // hex encoded uncompressed public key
}

// ============================================================================
// Sign Endpoints
// ============================================================================

export interface SignStartRequest extends BaseRequest {
  accountId: string;
  clientMessage?: string; // optional initial client message
}

export interface SignStartResponse extends BaseResponse {
  sessionId: string;
  serverMessage: string;
}

export interface SignStepRequest extends BaseRequest {
  sessionId: string;
  clientMessage: string;
}

export interface SignStepResponse extends BaseResponse {
  sessionId: string;
  status: 'CONTINUE' | 'DONE';
  serverMessage?: string;
  serverPartial?: string; // base64 encoded signature partial (present if DONE)
}

// ============================================================================
// Recovery Endpoints
// ============================================================================

export interface RecoverStartRequest extends BaseRequest {
  accountId: string;
  clientMessage: string;
}

export interface RecoverStartResponse extends BaseResponse {
  sessionId: string;
  status: 'CONTINUE' | 'DONE';
  serverMessage?: string;
  address?: string; // confirmation on DONE
}

export interface RecoverStepRequest extends BaseRequest {
  sessionId: string;
  clientMessage: string;
}

export interface RecoverStepResponse extends BaseResponse {
  sessionId: string;
  status: 'CONTINUE' | 'DONE';
  serverMessage?: string;
  address?: string;
}

// ============================================================================
// Health Endpoint
// ============================================================================

export interface HealthResponse extends BaseResponse {
  status: 'healthy';
  timestamp: string;
}

// ============================================================================
// KeyStore Types
// ============================================================================

export interface KeyStore {
  /**
   * Persist server shard for an account
   * @param accountId Unique account identifier
   * @param serverShard Raw server share material (must be kept secret)
   */
  persistServerShard(accountId: string, serverShard: Uint8Array | string): Promise<void>;

  /**
   * Load server shard for an account
   * @param accountId Unique account identifier
   * @returns Server share material
   * @throws Error if account not found
   */
  loadServerShard(accountId: string): Promise<Uint8Array | string>;

  /**
   * Check if an account exists
   */
  has(accountId: string): Promise<boolean>;

  /**
   * List all accounts (for admin/debugging)
   */
  listAccounts(): Promise<Array<{ accountId: string; address: string }>>;

  /**
   * Store account metadata (address, publicKey, etc.)
   */
  persistAccountMetadata(accountId: string, metadata: AccountMetadata): Promise<void>;

  /**
   * Load account metadata
   */
  loadAccountMetadata(accountId: string): Promise<AccountMetadata>;
}

export interface AccountMetadata {
  accountId: string;
  address: string;
  publicKey: string; // hex encoded
  label?: string;
  createdAt: string; // ISO timestamp
  lastUsedAt?: string;
}

// ============================================================================
// MPC Protocol Types
// ============================================================================

/**
 * MPC session state - opaque object maintained by the protocol layer
 */
export interface MPCSessionState {
  sessionId: string;
  protocol: 'DKG' | 'SIGN' | 'RECOVER';
  round: number;
  accountId?: string;
  internalState: unknown; // protocol-specific state
  createdAt: number;
  expiresAt: number;
}

/**
 * DKG result containing server shard and public key material
 */
export interface DKGResult {
  serverShard: Uint8Array;
  publicKey: Uint8Array; // uncompressed ECDSA public key (65 bytes)
  address: string; // Ethereum address derived from public key
}

/**
 * Signing result containing server's signature partial
 */
export interface SigningResult {
  serverPartial: Uint8Array; // server's signature share
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  verified: boolean;
  address: string;
}

// ============================================================================
// MPC Protocol Interface
// ============================================================================

export interface MPCProtocol {
  /**
   * Start a new DKG session
   * @returns Initial server message and session state
   */
  startDKG(): Promise<{ sessionState: MPCSessionState; serverMessage: Uint8Array }>;

  /**
   * Process a DKG step (multi-round)
   * @returns Next server message or completion result
   */
  stepDKG(
    sessionState: MPCSessionState,
    clientMessage: Uint8Array
  ): Promise<{
    sessionState: MPCSessionState;
    done: boolean;
    serverMessage?: Uint8Array;
    result?: DKGResult;
  }>;

  /**
   * Start a signing session
   * @param serverShard Server's key share
   * @param messageHash Message hash to sign (32 bytes)
   */
  startSign(
    serverShard: Uint8Array | string,
    messageHash: Uint8Array
  ): Promise<{ sessionState: MPCSessionState; serverMessage: Uint8Array }>;

  /**
   * Process a signing step (multi-round)
   */
  stepSign(
    sessionState: MPCSessionState,
    clientMessage: Uint8Array
  ): Promise<{
    sessionState: MPCSessionState;
    done: boolean;
    serverMessage?: Uint8Array;
    result?: SigningResult;
  }>;

  /**
   * Start a recovery session (verify client has valid shard)
   */
  startRecover(
    accountId: string,
    serverShard: Uint8Array | string,
    clientMessage: Uint8Array
  ): Promise<{
    sessionState: MPCSessionState;
    done: boolean;
    serverMessage?: Uint8Array;
    result?: RecoveryResult;
  }>;

  /**
   * Process a recovery step
   */
  stepRecover(
    sessionState: MPCSessionState,
    clientMessage: Uint8Array
  ): Promise<{
    sessionState: MPCSessionState;
    done: boolean;
    serverMessage?: Uint8Array;
    result?: RecoveryResult;
  }>;
}

// ============================================================================
// Session Management
// ============================================================================

export interface SessionManager {
  create(protocol: 'DKG' | 'SIGN' | 'RECOVER', accountId?: string): MPCSessionState;
  get(sessionId: string): MPCSessionState | undefined;
  update(sessionState: MPCSessionState): void;
  delete(sessionId: string): void;
  cleanup(): void; // Remove expired sessions
}

// ============================================================================
// Configuration
// ============================================================================

export interface EnclaveConfig {
  port: number;
  mockMode: boolean;
  sealedStoragePath: string;
  sessionTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
