import { VsockServer, VsockSocket } from 'node-vsock';

interface VsockRequest {
  type: 'health' | 'status' | 'compute';
  data?: any;
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
    switch (request.type) {
      case 'health':
        return {
          success: true,
          data: {
            status: 'healthy',
            enclave: true
          },
          timestamp: new Date().toISOString()
        };

      case 'status':
        return {
          success: true,
          data: {
            enclave: 'initialized',
            secure: true,
            ready: true,
            vsock: 'connected'
          },
          timestamp: new Date().toISOString()
        };

      case 'compute':
        return {
          success: true,
          data: {
            result: 'computation completed',
            inputReceived: !!request.data,
            processedData: request.data
          },
          timestamp: new Date().toISOString()
        };

      default:
        return {
          success: false,
          error: 'Unknown request type',
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
