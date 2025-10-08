#!/usr/bin/env node

/**
 * Parent Instance Client for AWS Nitro Enclave Communication
 *
 * This script runs on the parent EC2 instance and communicates with
 * the enclave via vsock socket.
 */

const { VsockSocket } = require('node-vsock');
const { execSync } = require('child_process');

// Configuration
const VSOCK_PORT = 5000;  // Must match the port in the enclave
const PARENT_CID = 3;     // Parent instance always uses CID 3

/**
 * Get the CID of the running enclave
 */
function getEnclaveCID() {
  try {
    const output = execSync('nitro-cli describe-enclaves', { encoding: 'utf-8' });
    const enclaves = JSON.parse(output);

    if (enclaves.length === 0) {
      console.error('Error: No running enclaves found');
      console.error('Start an enclave first with: ./run-enclave.sh');
      process.exit(1);
    }

    const enclaveCID = enclaves[0].EnclaveCID;
    console.log(`Found running enclave with CID: ${enclaveCID}`);
    return enclaveCID;
  } catch (err) {
    console.error('Error getting enclave CID:', err.message);
    console.error('Make sure nitro-cli is installed and an enclave is running');
    process.exit(1);
  }
}

/**
 * Send a request to the enclave and wait for response
 */
function sendRequest(cid, request) {
  return new Promise((resolve, reject) => {
    const client = new VsockSocket();
    let responseData = '';

    client.on('error', (err) => {
      console.error('Socket error:', err.message);
      reject(err);
    });

    client.connect(cid, VSOCK_PORT, () => {
      console.log(`Connected to enclave (CID: ${cid}, Port: ${VSOCK_PORT})`);
      console.log('Sending request:', JSON.stringify(request));

      client.on('data', (buf) => {
        responseData += buf.toString();

        // Try to parse the response (ends with newline)
        if (responseData.includes('\n')) {
          try {
            const response = JSON.parse(responseData.trim());
            client.end();
            resolve(response);
          } catch (err) {
            // Not valid JSON yet, wait for more data
          }
        }
      });

      client.on('end', () => {
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
        // Connection closed without response
        if (!responseData) {
          reject(new Error('Connection closed without response'));
        }
      });

      // Send the request (don't close immediately)
      client.writeTextSync(JSON.stringify(request));
    });
  });
}

/**
 * Test different request types
 */
async function runTests() {
  console.log('========================================');
  console.log('AWS Nitro Enclave Communication Test');
  console.log('========================================\n');

  const enclaveCID = getEnclaveCID();
  console.log('');

  // Test 1: Health check
  try {
    console.log('[Test 1] Health Check');
    console.log('-------------------');
    const healthResponse = await sendRequest(enclaveCID, { type: 'health' });
    console.log('Response:', JSON.stringify(healthResponse, null, 2));
    console.log('✓ Health check passed\n');
  } catch (err) {
    console.error('✗ Health check failed:', err.message, '\n');
  }

  // Test 2: Status check
  try {
    console.log('[Test 2] Status Check');
    console.log('-------------------');
    const statusResponse = await sendRequest(enclaveCID, { type: 'status' });
    console.log('Response:', JSON.stringify(statusResponse, null, 2));
    console.log('✓ Status check passed\n');
  } catch (err) {
    console.error('✗ Status check failed:', err.message, '\n');
  }

  // Test 3: Compute request
  try {
    console.log('[Test 3] Compute Request');
    console.log('-------------------');
    const computeResponse = await sendRequest(enclaveCID, {
      type: 'compute',
      data: {
        operation: 'encrypt',
        payload: 'sensitive data',
        timestamp: new Date().toISOString()
      }
    });
    console.log('Response:', JSON.stringify(computeResponse, null, 2));
    console.log('✓ Compute request passed\n');
  } catch (err) {
    console.error('✗ Compute request failed:', err.message, '\n');
  }

  console.log('========================================');
  console.log('All tests completed!');
  console.log('========================================');
}

// Run the tests
runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
