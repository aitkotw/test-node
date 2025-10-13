#!/usr/bin/env node

/**
 * Parent Instance API Server for AWS Nitro Enclave Communication
 *
 * This script runs on the parent EC2 instance and:
 * 1. Exposes REST API endpoints
 * 2. Forwards requests to the enclave via vsock
 * 3. Returns enclave responses to API callers
 */

const express = require('express');
const { VsockSocket } = require('node-vsock');
const { execSync } = require('child_process');

// Configuration
const API_PORT = process.env.API_PORT || 4000;
const VSOCK_PORT = 5000;  // Must match the port in the enclave
const PARENT_CID = 3;     // Parent instance always uses CID 3

// Cache the enclave CID to avoid repeated lookups
let cachedEnclaveCID = null;

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
    console.log(`[Parent API] Found running enclave with CID: ${enclaveCID}`);
    cachedEnclaveCID = enclaveCID;
    return enclaveCID;
  } catch (err) {
    console.error('[Parent API] Error getting enclave CID:', err.message);
    throw new Error('Failed to connect to enclave. Make sure nitro-cli is installed and an enclave is running.');
  }
}

/**
 * Send a request to the enclave and wait for response
 */
async function sendToEnclave(request) {
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
    }, 30000); // 30 second timeout

    client.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[Parent API] Socket error:', err.message);
      reject(err);
    });

    client.connect(cid, VSOCK_PORT, () => {
      console.log(`[Parent API] Connected to enclave (CID: ${cid}, Port: ${VSOCK_PORT})`);
      console.log('[Parent API] Sending request:', JSON.stringify(request));

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
        // Connection closed without response
        if (!responseData) {
          reject(new Error('Connection closed without response'));
        }
      });

      // Send the request
      client.writeTextSync(JSON.stringify(request));
    });
  });
}

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * API Routes
 */

// Health check for the parent API itself
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'parent-api',
    timestamp: new Date().toISOString()
  });
});

// Forward health check to enclave
app.get('/api/enclave/health', async (req, res) => {
  try {
    console.log('[Parent API] Received health check request');
    const response = await sendToEnclave({ type: 'health' });
    res.json(response);
  } catch (err) {
    console.error('[Parent API] Health check failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Forward status check to enclave
app.get('/api/enclave/status', async (req, res) => {
  try {
    console.log('[Parent API] Received status check request');
    const response = await sendToEnclave({ type: 'status' });
    res.json(response);
  } catch (err) {
    console.error('[Parent API] Status check failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Forward compute request to enclave
app.post('/api/enclave/compute', async (req, res) => {
  try {
    console.log('[Parent API] Received compute request');
    const response = await sendToEnclave({
      type: 'compute',
      data: req.body
    });
    res.json(response);
  } catch (err) {
    console.error('[Parent API] Compute request failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Generic proxy endpoint - forwards any request type to enclave
app.post('/api/enclave/request', async (req, res) => {
  try {
    console.log('[Parent API] Received generic request');
    const response = await sendToEnclave(req.body);
    res.json(response);
  } catch (err) {
    console.error('[Parent API] Generic request failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Start the API server
app.listen(API_PORT, () => {
  console.log('========================================');
  console.log('Parent Instance API Server');
  console.log('========================================');
  console.log(`[Parent API] Server running on port ${API_PORT}`);
  console.log(`[Parent API] Ready to forward requests to enclave`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${API_PORT}/health`);
  console.log(`  GET  http://localhost:${API_PORT}/api/enclave/health`);
  console.log(`  GET  http://localhost:${API_PORT}/api/enclave/status`);
  console.log(`  POST http://localhost:${API_PORT}/api/enclave/compute`);
  console.log(`  POST http://localhost:${API_PORT}/api/enclave/request`);
  console.log('========================================');
});
