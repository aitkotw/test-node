import { VsockServer, VsockSocket } from 'node-vsock';

interface VsockRequest {
  type: 'health' | 'status' | 'compute' | 'encrypt' | 'decrypt' | 'sign' | 'verify';
  data?: any;
  operation?: string;
  payload?: any;
}

interface VsockResponse {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

export class EnclaveVsockServer {
  private server: VsockServer;
  private port: number;

  constructor(port: number = 5000) {
    this.port = port;
    this.server = new VsockServer();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.server.on('error', (err: Error) => {
      console.error('[Vsock Server] Error:', err.message);
    });

    this.server.on('connection', (socket: VsockSocket) => {
      console.log('[Vsock Server] New connection from parent instance');
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: VsockSocket): void {
    let dataBuffer = '';

    socket.on('error', (err: Error) => {
      console.error('[Vsock Socket] Error:', err.message);
    });

    socket.on('data', (buf: Buffer) => {
      // Accumulate data
      dataBuffer += buf.toString();

      try {
        // Try to parse complete JSON
        const request: VsockRequest = JSON.parse(dataBuffer);
        console.log('[Vsock Server] Received:', JSON.stringify(request));

        // Process request
        const response = this.processRequest(request);
        const responseStr = JSON.stringify(response) + '\n';

        // Write response and close
        console.log('[Vsock Server] Sending:', responseStr.trim());
        socket.writeTextSync(responseStr);

        // Give time for write to complete before closing
        setTimeout(() => {
          socket.end();
        }, 10);

      } catch (err) {
        // Not complete JSON yet, or error parsing
        if (err instanceof SyntaxError && dataBuffer.length < 10000) {
          // Wait for more data
          return;
        }

        console.error('[Vsock Server] Parse error:', err);
        const errorResponse: VsockResponse = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString()
        };

        try {
          socket.writeTextSync(JSON.stringify(errorResponse) + '\n');
          setTimeout(() => socket.end(), 10);
        } catch (writeErr) {
          console.error('[Vsock Server] Write failed:', writeErr);
        }
      }
    });

    socket.on('end', () => {
      console.log('[Vsock Server] Connection closed');
    });
  }

  private processRequest(request: VsockRequest): VsockResponse {
    console.log(`[Enclave] Processing request type: ${request.type}`);

    switch (request.type) {
      case 'health':
        return this.handleHealthCheck();

      case 'status':
        return this.handleStatusCheck();

      case 'compute':
        return this.handleCompute(request);

      case 'encrypt':
        return this.handleEncrypt(request);

      case 'decrypt':
        return this.handleDecrypt(request);

      case 'sign':
        return this.handleSign(request);

      case 'verify':
        return this.handleVerify(request);

      default:
        return {
          success: false,
          error: `Unknown request type: ${request.type}`,
          timestamp: new Date().toISOString()
        };
    }
  }

  private handleHealthCheck(): VsockResponse {
    return {
      success: true,
      data: {
        status: 'healthy',
        enclave: true,
        environment: 'AWS Nitro Enclave'
      },
      timestamp: new Date().toISOString()
    };
  }

  private handleStatusCheck(): VsockResponse {
    return {
      success: true,
      data: {
        enclave: 'initialized',
        secure: true,
        ready: true,
        vsock: 'connected',
        capabilities: ['compute', 'encrypt', 'decrypt', 'sign', 'verify']
      },
      timestamp: new Date().toISOString()
    };
  }

  private handleCompute(request: VsockRequest): VsockResponse {
    try {
      const { data, operation, payload } = request;

      // Simulate computation based on operation type
      let result: any;

      if (operation === 'sum' && Array.isArray(payload)) {
        result = payload.reduce((acc, val) => acc + val, 0);
      } else if (operation === 'multiply' && Array.isArray(payload)) {
        result = payload.reduce((acc, val) => acc * val, 1);
      } else {
        result = {
          message: 'computation completed',
          inputReceived: !!data || !!payload,
          processedData: data || payload
        };
      }

      return {
        success: true,
        data: {
          result,
          operation: operation || 'generic'
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Computation failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  private handleEncrypt(request: VsockRequest): VsockResponse {
    try {
      const { payload } = request;

      if (!payload) {
        throw new Error('Payload is required for encryption');
      }

      // Simulate encryption (in real implementation, use actual crypto)
      const encrypted = Buffer.from(JSON.stringify(payload)).toString('base64');

      return {
        success: true,
        data: {
          encrypted,
          algorithm: 'simulated-aes-256-gcm',
          message: 'Data encrypted successfully in secure enclave'
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Encryption failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  private handleDecrypt(request: VsockRequest): VsockResponse {
    try {
      const { payload } = request;

      if (!payload) {
        throw new Error('Encrypted payload is required for decryption');
      }

      // Simulate decryption (in real implementation, use actual crypto)
      const decrypted = JSON.parse(Buffer.from(payload, 'base64').toString());

      return {
        success: true,
        data: {
          decrypted,
          message: 'Data decrypted successfully in secure enclave'
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Decryption failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  private handleSign(request: VsockRequest): VsockResponse {
    try {
      const { payload } = request;

      if (!payload) {
        throw new Error('Payload is required for signing');
      }

      // Simulate signing (in real implementation, use actual crypto)
      const signature = Buffer.from(JSON.stringify(payload) + '-signature').toString('base64');

      return {
        success: true,
        data: {
          signature,
          algorithm: 'simulated-ecdsa',
          message: 'Data signed successfully in secure enclave'
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Signing failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  private handleVerify(request: VsockRequest): VsockResponse {
    try {
      const { payload, signature } = request.data || {};

      if (!payload || !signature) {
        throw new Error('Payload and signature are required for verification');
      }

      // Simulate verification (in real implementation, use actual crypto)
      const expectedSignature = Buffer.from(JSON.stringify(payload) + '-signature').toString('base64');
      const isValid = signature === expectedSignature;

      return {
        success: true,
        data: {
          valid: isValid,
          message: isValid ? 'Signature verified successfully' : 'Signature verification failed'
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Verification failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  public listen(): void {
    try {
      this.server.listen(this.port);
      console.log(`[Vsock Server] Listening on port ${this.port}`);
      console.log('[Vsock Server] Ready for connections from parent instance (CID 3)');
    } catch (err) {
      console.error('[Vsock Server] Failed to start:', err);
      throw err;
    }
  }

  public close(): void {
    // Note: VsockServer doesn't have a close method in the current implementation
    console.log('[Vsock Server] Shutdown requested');
  }
}
