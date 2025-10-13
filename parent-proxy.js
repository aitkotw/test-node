/**
 * Parent Proxy Server
 *
 * Runs on EC2 parent instance. Forwards client HTTPS requests to enclave
 * HTTP server via vsock-forwarded TCP (localhost:5000).
 *
 * Architecture:
 * Client (HTTPS) → Parent Proxy (this) → vsock → Enclave (HTTP on :5000)
 *
 * Responsibilities:
 * - Terminate TLS/HTTPS from external clients
 * - Forward requests to enclave over vsock-forwarded localhost connection
 * - Return enclave responses to client
 * - Rate limiting and DDoS protection
 * - Request logging (non-secret info only)
 *
 * PRODUCTION TODOS:
 * - Add TLS/HTTPS termination with proper certificates
 * - Implement rate limiting per client IP
 * - Add request authentication (API keys, JWT, etc.)
 * - Verify enclave attestation before forwarding sensitive requests
 * - Add audit logging to CloudWatch or external SIEM
 * - Implement health checks and auto-restart
 * - Add metrics collection (request count, latency, error rates)
 */

import express from 'express';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  port: parseInt(process.env.PROXY_PORT || '3000', 10),
  enclaveUrl: process.env.ENCLAVE_URL || 'http://127.0.0.1:5000',
  rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitMaxRequests: 100, // Max requests per window per IP
  requestTimeoutMs: 30000, // 30 seconds
  logLevel: process.env.LOG_LEVEL || 'info',
};

// ============================================================================
// Express App
// ============================================================================

const app = express();

// Security middleware
app.use(helmet());

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/v1/', limiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log('info', `${req.method} ${req.path} ${res.statusCode} ${duration}ms [${req.ip}]`);
  });
  next();
});

// ============================================================================
// Health Check (Parent-side)
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    proxy: 'parent',
  });
});

// ============================================================================
// Forward All /v1/* Requests to Enclave
// ============================================================================

app.all('/v1/*', async (req, res) => {
  const targetUrl = `${config.enclaveUrl}${req.path}`;

  try {
    log('debug', `Forwarding ${req.method} ${req.path} to enclave`);

    // Forward request to enclave
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: config.requestTimeoutMs,
      validateStatus: () => true, // Don't throw on non-2xx status
    });

    // Return enclave response to client
    res.status(response.status).json(response.data);
  } catch (err) {
    log('error', `Failed to forward request to enclave: ${err.message}`);

    // Handle connection errors
    if (err.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: {
          code: 'ENCLAVE_UNAVAILABLE',
          message: 'Enclave service is unavailable',
        },
      });
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      res.status(504).json({
        error: {
          code: 'ENCLAVE_TIMEOUT',
          message: 'Enclave request timed out',
        },
      });
    } else {
      res.status(500).json({
        error: {
          code: 'PROXY_ERROR',
          message: 'Failed to communicate with enclave',
        },
      });
    }
  }
});

// ============================================================================
// Remote Attestation Endpoint (Optional)
// ============================================================================

/**
 * PRODUCTION TODO: Add attestation verification
 *
 * Before allowing DKG, clients should verify enclave attestation:
 * 1. Enclave generates attestation document (AWS Nitro SDK)
 * 2. Parent proxy exposes attestation endpoint
 * 3. Client retrieves and verifies attestation (PCR measurements, signature)
 * 4. Client proceeds with DKG only if attestation is valid
 */
app.get('/v1/attestation', async (req, res) => {
  log('warn', 'Attestation endpoint called but not implemented');

  // TODO: Retrieve attestation document from enclave
  // const attestationDoc = await getEnclaveAttestation();

  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Attestation not yet implemented',
    },
  });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  log('error', `Unhandled error: ${err.message}`);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal proxy error',
    },
  });
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(config.port, '0.0.0.0', () => {
  log('info', `Parent proxy listening on port ${config.port}`);
  log('info', `Forwarding to enclave at ${config.enclaveUrl}`);
  log('info', `Rate limit: ${config.rateLimitMaxRequests} requests per ${config.rateLimitWindowMs / 1000}s`);
});

// ============================================================================
// Utilities
// ============================================================================

function log(level, message) {
  const levels = ['debug', 'info', 'warn', 'error'];
  const configLevel = levels.indexOf(config.logLevel);
  const msgLevel = levels.indexOf(level);

  if (msgLevel >= configLevel) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

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

/**
 * PRODUCTION DEPLOYMENT CHECKLIST:
 *
 * 1. TLS/HTTPS:
 *    - Add HTTPS support with Let's Encrypt certificates
 *    - Use cert-manager or AWS Certificate Manager
 *    - Enforce HTTPS redirects
 *    - Configure strong TLS ciphers (TLS 1.3 preferred)
 *
 * 2. Authentication:
 *    - Add API key authentication for clients
 *    - Or use JWT tokens with proper validation
 *    - Consider OAuth 2.0 for user-facing applications
 *
 * 3. Rate Limiting:
 *    - Tune rate limits based on expected traffic
 *    - Add per-endpoint rate limits (stricter for DKG/sign)
 *    - Consider Redis-backed rate limiting for multi-instance deployments
 *
 * 4. Monitoring:
 *    - Add CloudWatch metrics (request count, latency, errors)
 *    - Set up alarms for high error rates or latency
 *    - Add distributed tracing (X-Ray, Jaeger, etc.)
 *
 * 5. Logging:
 *    - Send logs to CloudWatch Logs or external SIEM
 *    - Add structured logging (JSON format)
 *    - Include request IDs for correlation
 *    - NEVER log secrets or sensitive data
 *
 * 6. Attestation:
 *    - Implement attestation document retrieval from enclave
 *    - Verify attestation before forwarding DKG requests
 *    - Cache attestation documents with TTL
 *    - Include PCR measurements in attestation response
 *
 * 7. High Availability:
 *    - Deploy multiple parent instances behind load balancer
 *    - Use health check endpoint for ALB/NLB
 *    - Implement circuit breaker for enclave communication
 *    - Add retry logic with exponential backoff
 *
 * 8. Security:
 *    - Implement CORS policies if serving browser clients
 *    - Add request validation (schema validation)
 *    - Implement request size limits
 *    - Add WAF rules for common attacks
 *    - Regular security audits and penetration testing
 *
 * 9. vsock Configuration:
 *    - Ensure vsock-proxy or socat is configured correctly
 *    - Example: socat TCP-LISTEN:5000,reuseaddr,fork VSOCK-CONNECT:3:5000
 *    - Where 3 is the enclave CID and 5000 is the enclave port
 *    - Add health checks to verify vsock connectivity
 *
 * 10. Documentation:
 *     - Document all API endpoints
 *     - Provide example client code
 *     - Include error code reference
 *     - Document rate limits and quotas
 */

/**
 * Example vsock setup (on parent EC2 instance):
 *
 * # Install socat
 * sudo yum install -y socat
 *
 * # Forward localhost:5000 to enclave CID 3, port 5000
 * socat TCP-LISTEN:5000,reuseaddr,fork VSOCK-CONNECT:3:5000
 *
 * # Or use vsock-proxy (AWS Nitro Enclaves SDK)
 * vsock-proxy 5000 127.0.0.1:5000 3
 *
 * # Run as systemd service for auto-restart
 */
