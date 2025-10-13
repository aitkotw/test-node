#!/usr/bin/env node

/**
 * Parent Instance API Server for MPC Enclave Communication
 *
 * This script runs on the parent EC2 instance and:
 * 1. Exposes REST API endpoints (HTTPS) to external clients
 * 2. Forwards requests to the enclave via vsock
 * 3. Returns enclave responses to API callers
 *
 * Architecture:
 *   Client (HTTPS) → This Server → vsock → Enclave
 */

const express = require('express');
const { VsockSocket } = require('node-vsock');
const { execSync } = require('child_process');

// ============================================================================
// Configuration
// ============================================================================

const API_PORT = parseInt(process.env.API_PORT || '4000', 10);
const VSOCK_PORT = parseInt(process.env.VSOCK_PORT || '5000', 10);
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Cache the enclave CID to avoid repeated lookups
let cachedEnclaveCID = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the CID of the running enclave (with caching)
 */
function getEnclaveCID() {
  if (cachedEnclaveCID) {
    return cachedEnclaveCID;
  }

  try {
    const output = execSync('nitro-cli describe-enclaves', { encoding: 'utf-8' });
    const enclaves = JSON.parse(output);

    if (enclaves.length === 0) {
      throw new Error('No running enclaves found');
    }

    const enclaveCID = enclaves[0].EnclaveCID;
    log('info', `Found running enclave with CID: ${enclaveCID}`);
    cachedEnclaveCID = enclaveCID;
    return enclaveCID;
  } catch (err) {
    log('error', `Error getting enclave CID: ${err.message}`);
    throw new Error('Failed to connect to enclave. Make sure nitro-cli is installed and an enclave is running.');
  }
}

/**
 * Send a request to the enclave via vsock and wait for response
 */
async function sendToEnclave(endpoint, body) {
  return new Promise((resolve, reject) => {
    let cid;
    try {
      cid = getEnclaveCID();
    } catch (err) {
      return reject(err);
    }

    const client = new VsockSocket();
    let responseData = '';

    const timeout = setTimeout(() => {
      client.end();
      reject(new Error('Request timeout'));
    }, REQUEST_TIMEOUT);

    client.on('error', (err) => {
      clearTimeout(timeout);
      log('error', `vsock socket error: ${err.message}`);
      reject(err);
    });

    client.connect(cid, VSOCK_PORT, () => {
      log('debug', `Connected to enclave (CID: ${cid}, Port: ${VSOCK_PORT})`);

      const request = {
        type: 'mpc',
        endpoint,
        body,
      };

      log('debug', `Sending to enclave: ${endpoint}`);

      client.on('data', (buf) => {
        responseData += buf.toString();

        // Try to parse the response (ends with newline)
        if (responseData.includes('\n')) {
          try {
            const response = JSON.parse(responseData.trim());
            clearTimeout(timeout);
            client.end();
            resolve(response);
          } catch (err) {
            // Not valid JSON yet, wait for more data
          }
        }
      });

      client.on('end', () => {
        clearTimeout(timeout);
        if (responseData) {
          try {
            const response = JSON.parse(responseData.trim());
            resolve(response);
          } catch (err) {
            reject(new Error('Invalid JSON response: ' + responseData));
          }
        }
      });

      client.on('close', () => {
        clearTimeout(timeout);
        if (!responseData) {
          reject(new Error('Connection closed without response'));
        }
      });

      // Send the request
      client.writeTextSync(JSON.stringify(request));
    });
  });
}

/**
 * Logging function
 */
function log(level, message) {
  const levels = ['debug', 'info', 'warn', 'error'];
  const configLevel = levels.indexOf(LOG_LEVEL);
  const msgLevel = levels.indexOf(level);

  if (msgLevel >= configLevel) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

// ============================================================================
// Express App
// ============================================================================

const app = express();
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log('info', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ============================================================================
// API Routes
// ============================================================================

// Parent health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'parent-api',
    timestamp: new Date().toISOString(),
  });
});

// Enclave health check
app.get('/v1/health', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/health', {});

    if (response.success) {
      res.json(response.data);
    } else {
      res.status(500).json(response.error);
    }
  } catch (err) {
    log('error', `Health check failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_UNAVAILABLE',
        message: err.message,
      },
    });
  }
});

// ============================================================================
// MPC Endpoints - Forward to Enclave
// ============================================================================

// Create Account - Start
app.post('/v1/createAccount/start', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/createAccount/start', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      res.status(400).json(response.error);
    }
  } catch (err) {
    log('error', `createAccount/start failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Create Account - Step
app.post('/v1/createAccount/step', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/createAccount/step', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      res.status(400).json(response.error);
    }
  } catch (err) {
    log('error', `createAccount/step failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Get Public Key
app.post('/v1/getPublicKey', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/getPublicKey', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      const statusCode = response.error.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json(response.error);
    }
  } catch (err) {
    log('error', `getPublicKey failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Sign - Start
app.post('/v1/sign/start', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/sign/start', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      const statusCode = response.error.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json(response.error);
    }
  } catch (err) {
    log('error', `sign/start failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Sign - Step
app.post('/v1/sign/step', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/sign/step', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      res.status(400).json(response.error);
    }
  } catch (err) {
    log('error', `sign/step failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Recover - Start
app.post('/v1/recover/start', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/recover/start', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      const statusCode = response.error.code === 'ACCOUNT_NOT_FOUND' ? 404 : 400;
      res.status(statusCode).json(response.error);
    }
  } catch (err) {
    log('error', `recover/start failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// Recover - Step
app.post('/v1/recover/step', async (req, res) => {
  try {
    const response = await sendToEnclave('/v1/recover/step', req.body);

    if (response.success) {
      res.json(response.data);
    } else {
      res.status(400).json(response.error);
    }
  } catch (err) {
    log('error', `recover/step failed: ${err.message}`);
    res.status(500).json({
      error: {
        code: 'ENCLAVE_ERROR',
        message: err.message,
      },
    });
  }
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  log('error', `Unhandled error: ${err.message}`);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(API_PORT, () => {
  console.log('========================================');
  console.log('Parent Instance API Server - MPC Service');
  console.log('========================================');
  log('info', `Server running on port ${API_PORT}`);
  log('info', `Forwarding requests to enclave on vsock port ${VSOCK_PORT}`);
  log('info', `Request timeout: ${REQUEST_TIMEOUT}ms`);
  log('info', `Log level: ${LOG_LEVEL}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${API_PORT}/health`);
  console.log(`  GET  http://localhost:${API_PORT}/v1/health`);
  console.log(`  POST http://localhost:${API_PORT}/v1/createAccount/start`);
  console.log(`  POST http://localhost:${API_PORT}/v1/createAccount/step`);
  console.log(`  POST http://localhost:${API_PORT}/v1/getPublicKey`);
  console.log(`  POST http://localhost:${API_PORT}/v1/sign/start`);
  console.log(`  POST http://localhost:${API_PORT}/v1/sign/step`);
  console.log(`  POST http://localhost:${API_PORT}/v1/recover/start`);
  console.log(`  POST http://localhost:${API_PORT}/v1/recover/step`);
  console.log('========================================');
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('info', 'SIGINT received, shutting down gracefully');
  process.exit(0);
});
