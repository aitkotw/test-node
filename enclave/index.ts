/**
 * MPC-based Two-Party Signing Service - Enclave Server with vsock
 *
 * Runs inside AWS Nitro Enclave. Accepts requests via vsock from parent instance.
 *
 * SECURITY NOTES:
 * - No external network egress from enclave
 * - All client communication happens via parent-client.js on parent instance
 * - Server shards sealed to enclave (file-based placeholder in dev)
 * - Never log secrets, private keys, or share material
 *
 * ARCHITECTURE:
 * - Parent-client.js (on EC2) receives HTTPS requests from clients
 * - Parent-client.js forwards to this enclave via vsock
 * - This enclave processes MPC operations and returns results
 * - No HTTP server in enclave - pure vsock communication
 */

import { VsockServer, VsockSocket } from 'node-vsock';
import { createMPCProtocol, SessionManager } from './mpc-protocol.js';
import { createKeyStore } from './keystore.js';
import * as crypto from 'crypto';
import type {
  EnclaveConfig,
  KeyStore,
  MPCProtocol,
  ErrorCode,
  AccountMetadata,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

const config: EnclaveConfig = {
  port: parseInt(process.env.VSOCK_PORT || '5000', 10),
  mockMode: process.env.MOCK_MPC === 'true',
  sealedStoragePath: process.env.SEALED_STORAGE_PATH || '/opt/enclave/sealed',
  sessionTimeoutMs: 300000, // 5 minutes
  logLevel: (process.env.LOG_LEVEL as any) || 'info',
};

// ============================================================================
// Initialize Components
// ============================================================================

const mpcProtocol: MPCProtocol = createMPCProtocol(config.mockMode);
const sessionManager = new SessionManager();

const keyStore: KeyStore = createKeyStore({
  type: process.env.KEYSTORE_TYPE === 'memory' ? 'memory' : 'file',
  basePath: config.sealedStoragePath,
});

// Initialize keystore
if ('initialize' in keyStore) {
  await (keyStore as any).initialize();
}

// Periodic cleanup of expired sessions
setInterval(() => {
  sessionManager.cleanup();
}, 60000); // Every minute

// ============================================================================
// vsock Request/Response Types
// ============================================================================

interface VsockRequest {
  type: string;
  endpoint: string;
  body: any;
  requestId?: string;
}

interface VsockResponse {
  success: boolean;
  data?: any;
  error?: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
  timestamp: string;
}

// ============================================================================
// vsock Server
// ============================================================================

class MPCEnclaveVsockServer {
  private server: VsockServer;
  private port: number;

  constructor(port: number) {
    this.port = port;
    this.server = new VsockServer();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.server.on('error', (err: Error) => {
      log('error', `vsock Server Error: ${err.message}`);
    });

    this.server.on('connection', (socket: VsockSocket) => {
      log('info', 'New vsock connection from parent instance');
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: VsockSocket): void {
    let dataBuffer = '';

    socket.on('error', (err: Error) => {
      log('error', `vsock Socket Error: ${err.message}`);
    });

    socket.on('data', (buf: Buffer) => {
      dataBuffer += buf.toString();

      try {
        const request: VsockRequest = JSON.parse(dataBuffer);
        log('debug', `Received request: ${request.endpoint}`);

        // Process request asynchronously
        this.processRequest(request)
          .then((response) => {
            const responseStr = JSON.stringify(response) + '\n';
            log('debug', `Sending response for ${request.endpoint}`);
            socket.writeTextSync(responseStr);
            setTimeout(() => socket.end(), 10);
          })
          .catch((err) => {
            const errorResponse: VsockResponse = {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: err.message,
              },
              requestId: request.requestId,
              timestamp: new Date().toISOString(),
            };
            socket.writeTextSync(JSON.stringify(errorResponse) + '\n');
            setTimeout(() => socket.end(), 10);
          });
      } catch (err) {
        if (err instanceof SyntaxError && dataBuffer.length < 100000) {
          return; // Wait for more data
        }

        log('error', `Parse error: ${err}`);
        const errorResponse: VsockResponse = {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Failed to parse request',
          },
          timestamp: new Date().toISOString(),
        };

        try {
          socket.writeTextSync(JSON.stringify(errorResponse) + '\n');
          setTimeout(() => socket.end(), 10);
        } catch (writeErr) {
          log('error', `Write failed: ${writeErr}`);
        }
      }
    });

    socket.on('end', () => {
      log('debug', 'vsock connection closed');
    });
  }

  private async processRequest(request: VsockRequest): Promise<VsockResponse> {
    const { endpoint, body, requestId } = request;

    try {
      let result: any;

      // Route to appropriate handler based on endpoint
      switch (endpoint) {
        case '/v1/health':
          result = await this.handleHealth();
          break;

        case '/v1/createAccount/start':
          result = await this.handleCreateAccountStart(body);
          break;

        case '/v1/createAccount/step':
          result = await this.handleCreateAccountStep(body);
          break;

        case '/v1/getPublicKey':
          result = await this.handleGetPublicKey(body);
          break;

        case '/v1/sign/start':
          result = await this.handleSignStart(body);
          break;

        case '/v1/sign/step':
          result = await this.handleSignStep(body);
          break;

        case '/v1/recover/start':
          result = await this.handleRecoverStart(body);
          break;

        case '/v1/recover/step':
          result = await this.handleRecoverStep(body);
          break;

        default:
          throw new Error(`Unknown endpoint: ${endpoint}`);
      }

      return {
        success: true,
        data: result,
        requestId,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      log('error', `Error processing ${endpoint}: ${err.message}`);

      // Parse error code from error message if present
      let errorCode: ErrorCode = 'INTERNAL_ERROR';
      if (err.message.includes('INVALID_REQUEST')) errorCode = 'INVALID_REQUEST';
      else if (err.message.includes('INVALID_SESSION')) errorCode = 'INVALID_SESSION';
      else if (err.message.includes('ACCOUNT_NOT_FOUND')) errorCode = 'ACCOUNT_NOT_FOUND';
      else if (err.message.includes('KEYSTORE_ERROR')) errorCode = 'KEYSTORE_ERROR';
      else if (err.message.includes('MPC_ERROR')) errorCode = 'MPC_ERROR';
      else if (err.message.includes('SIGNING_ERROR')) errorCode = 'SIGNING_ERROR';
      else if (err.message.includes('RECOVERY_FAILED')) errorCode = 'RECOVERY_FAILED';

      return {
        success: false,
        error: {
          code: errorCode,
          message: err.message,
        },
        requestId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ==========================================================================
  // Endpoint Handlers
  // ==========================================================================

  private async handleHealth(): Promise<any> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      mockMode: config.mockMode,
      enclave: true,
    };
  }

  private async handleCreateAccountStart(body: any): Promise<any> {
    const { requestId, label, clientNodeId } = body;

    log('info', `Starting DKG for label=${label}`);

    const { sessionState, serverMessage } = await mpcProtocol.startDKG();
    sessionManager.update(sessionState);

    return {
      requestId,
      sessionId: sessionState.sessionId,
      serverMessage: Buffer.from(serverMessage).toString('base64'),
    };
  }

  private async handleCreateAccountStep(body: any): Promise<any> {
    const { requestId, sessionId, clientMessage } = body;

    const sessionState = sessionManager.get(sessionId);
    if (!sessionState) {
      throw new Error('INVALID_SESSION: Session not found or expired');
    }

    if (sessionState.protocol !== 'DKG') {
      throw new Error('INVALID_SESSION: Session is not a DKG session');
    }

    const clientMsgBytes = Buffer.from(clientMessage, 'base64');
    const result = await mpcProtocol.stepDKG(sessionState, clientMsgBytes);

    sessionManager.update(result.sessionState);

    if (result.done && result.result) {
      const accountId = generateAccountId();

      await keyStore.persistServerShard(accountId, result.result.serverShard);

      const metadata: AccountMetadata = {
        accountId,
        address: result.result.address,
        publicKey: Buffer.from(result.result.publicKey).toString('hex'),
        label: body.label,
        createdAt: new Date().toISOString(),
      };

      await keyStore.persistAccountMetadata(accountId, metadata);
      sessionManager.delete(sessionId);

      log('info', `DKG complete: accountId=${accountId}, address=${result.result.address}`);

      return {
        requestId,
        sessionId,
        status: 'DONE',
        accountId,
        address: result.result.address,
      };
    } else {
      return {
        requestId,
        sessionId,
        status: 'CONTINUE',
        serverMessage: result.serverMessage
          ? Buffer.from(result.serverMessage).toString('base64')
          : undefined,
      };
    }
  }

  private async handleGetPublicKey(body: any): Promise<any> {
    const { requestId, accountId } = body;

    if (!accountId) {
      throw new Error('INVALID_REQUEST: accountId is required');
    }

    const exists = await keyStore.has(accountId);
    if (!exists) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account ${accountId} not found`);
    }

    const metadata = await keyStore.loadAccountMetadata(accountId);

    return {
      requestId,
      accountId: metadata.accountId,
      address: metadata.address,
      publicKey: metadata.publicKey,
    };
  }

  private async handleSignStart(body: any): Promise<any> {
    const { requestId, accountId, clientMessage } = body;

    if (!accountId) {
      throw new Error('INVALID_REQUEST: accountId is required');
    }

    const exists = await keyStore.has(accountId);
    if (!exists) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account ${accountId} not found`);
    }

    const serverShard = await keyStore.loadServerShard(accountId);

    let messageHash: Uint8Array;
    if (clientMessage) {
      const clientMsg = JSON.parse(Buffer.from(clientMessage, 'base64').toString('utf-8'));
      messageHash = Buffer.from(clientMsg.messageHash, 'hex');
    } else {
      throw new Error('INVALID_REQUEST: clientMessage with messageHash required');
    }

    const { sessionState, serverMessage } = await mpcProtocol.startSign(serverShard, messageHash);
    sessionState.accountId = accountId;
    sessionManager.update(sessionState);

    log('info', `Signing started: accountId=${accountId}, sessionId=${sessionState.sessionId}`);

    return {
      requestId,
      sessionId: sessionState.sessionId,
      serverMessage: Buffer.from(serverMessage).toString('base64'),
    };
  }

  private async handleSignStep(body: any): Promise<any> {
    const { requestId, sessionId, clientMessage } = body;

    const sessionState = sessionManager.get(sessionId);
    if (!sessionState) {
      throw new Error('INVALID_SESSION: Session not found or expired');
    }

    if (sessionState.protocol !== 'SIGN') {
      throw new Error('INVALID_SESSION: Session is not a signing session');
    }

    const clientMsgBytes = Buffer.from(clientMessage, 'base64');
    const result = await mpcProtocol.stepSign(sessionState, clientMsgBytes);

    sessionManager.update(result.sessionState);

    if (result.done && result.result) {
      sessionManager.delete(sessionId);

      log('info', `Signing complete: accountId=${sessionState.accountId}, sessionId=${sessionId}`);

      // Update last used timestamp
      try {
        const metadata = await keyStore.loadAccountMetadata(sessionState.accountId!);
        metadata.lastUsedAt = new Date().toISOString();
        await keyStore.persistAccountMetadata(sessionState.accountId!, metadata);
      } catch {
        // Non-critical
      }

      return {
        requestId,
        sessionId,
        status: 'DONE',
        serverPartial: Buffer.from(result.result.serverPartial).toString('base64'),
      };
    } else {
      return {
        requestId,
        sessionId,
        status: 'CONTINUE',
        serverMessage: result.serverMessage
          ? Buffer.from(result.serverMessage).toString('base64')
          : undefined,
      };
    }
  }

  private async handleRecoverStart(body: any): Promise<any> {
    const { requestId, accountId, clientMessage } = body;

    if (!accountId || !clientMessage) {
      throw new Error('INVALID_REQUEST: accountId and clientMessage required');
    }

    const exists = await keyStore.has(accountId);
    if (!exists) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account ${accountId} not found`);
    }

    const serverShard = await keyStore.loadServerShard(accountId);
    const clientMsgBytes = Buffer.from(clientMessage, 'base64');

    const result = await mpcProtocol.startRecover(accountId, serverShard, clientMsgBytes);

    if (result.done && result.result) {
      if (result.result.verified) {
        log('info', `Recovery successful: accountId=${accountId}`);
        return {
          requestId,
          sessionId: result.sessionState.sessionId,
          status: 'DONE',
          address: result.result.address,
        };
      } else {
        throw new Error('RECOVERY_FAILED: Client shard verification failed');
      }
    } else {
      sessionManager.update(result.sessionState);
      return {
        requestId,
        sessionId: result.sessionState.sessionId,
        status: 'CONTINUE',
        serverMessage: result.serverMessage
          ? Buffer.from(result.serverMessage).toString('base64')
          : undefined,
      };
    }
  }

  private async handleRecoverStep(body: any): Promise<any> {
    const { requestId, sessionId, clientMessage } = body;

    const sessionState = sessionManager.get(sessionId);
    if (!sessionState) {
      throw new Error('INVALID_SESSION: Session not found or expired');
    }

    if (sessionState.protocol !== 'RECOVER') {
      throw new Error('INVALID_SESSION: Session is not a recovery session');
    }

    const clientMsgBytes = Buffer.from(clientMessage, 'base64');
    const result = await mpcProtocol.stepRecover(sessionState, clientMsgBytes);

    if (result.done && result.result) {
      sessionManager.delete(sessionId);
      return {
        requestId,
        sessionId,
        status: 'DONE',
        address: result.result.address,
      };
    } else {
      sessionManager.update(result.sessionState);
      return {
        requestId,
        sessionId,
        status: 'CONTINUE',
        serverMessage: result.serverMessage
          ? Buffer.from(result.serverMessage).toString('base64')
          : undefined,
      };
    }
  }

  // ==========================================================================
  // Server Lifecycle
  // ==========================================================================

  public listen(): void {
    try {
      this.server.listen(this.port);
      log('info', `vsock Server listening on port ${this.port}`);
      log('info', 'Ready for connections from parent instance (CID 3)');
      log('info', `Mock mode: ${config.mockMode}`);
      log('info', `Sealed storage: ${config.sealedStoragePath}`);
    } catch (err) {
      log('error', `Failed to start vsock server: ${err}`);
      throw err;
    }
  }

  public close(): void {
    log('info', 'vsock server shutdown requested');
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateAccountId(): string {
  return `acct-${crypto.randomBytes(16).toString('hex')}`;
}

function log(level: string, message: string): void {
  const levels = ['debug', 'info', 'warn', 'error'];
  const configLevel = levels.indexOf(config.logLevel);
  const msgLevel = levels.indexOf(level);

  if (msgLevel >= configLevel) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

// ============================================================================
// Start Server
// ============================================================================

log('info', '='.repeat(60));
log('info', 'MPC Two-Party Signing Service - Enclave Server');
log('info', '='.repeat(60));

try {
  const vsockServer = new MPCEnclaveVsockServer(config.port);
  vsockServer.listen();

  // Handle shutdown signals
  process.on('SIGTERM', () => {
    log('info', 'SIGTERM received, shutting down...');
    vsockServer.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'SIGINT received, shutting down...');
    vsockServer.close();
    process.exit(0);
  });
} catch (err) {
  log('error', `Fatal error: ${err}`);
  if (!config.mockMode) {
    log('error', 'This service must run inside an AWS Nitro Enclave');
  }
  process.exit(1);
}
