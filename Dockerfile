# ============================================================
# AWS Nitro Enclave - MPC Signing Service
# ============================================================
# This Dockerfile builds the enclave application that runs
# inside AWS Nitro Enclave with vsock communication.
#
# Structure:
#   - Builds enclave/ TypeScript code
#   - Runs inside enclave (no external network)
#   - Communicates via vsock only
# ============================================================

# ----------------------------------------------------
# STAGE 1: BUILD ENCLAVE APPLICATION
# ----------------------------------------------------
FROM node:18-alpine AS builder

WORKDIR /build

# Copy enclave package files
COPY enclave/package.json enclave/package-lock.json* ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy enclave source code
COPY enclave/ ./

# Compile TypeScript to JavaScript
RUN npm run build

# ----------------------------------------------------
# STAGE 2: PRODUCTION RUNTIME
# ----------------------------------------------------
FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy enclave package files
COPY enclave/package.json enclave/package-lock.json* ./

# Install ONLY production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy compiled application from builder stage
COPY --from=builder /build/dist ./dist

# Create sealed storage directory for server shards
RUN mkdir -p /opt/enclave/sealed && \
    chmod 700 /opt/enclave/sealed

# Environment variables
ENV NODE_ENV=production \
    VSOCK_PORT=5000 \
    MOCK_MPC=false \
    KEYSTORE_TYPE=file \
    SEALED_STORAGE_PATH=/opt/enclave/sealed \
    LOG_LEVEL=info

# Expose vsock port (internal only, no external network in enclave)
EXPOSE 5000

# Create non-root user for security
RUN addgroup -g 1000 enclave && \
    adduser -D -u 1000 -G enclave enclave && \
    chown -R enclave:enclave /app /opt/enclave

# Switch to non-root user
USER enclave

# Use dumb-init for proper signal handling
# Run the enclave server (vsock server with MPC endpoints)
ENTRYPOINT ["dumb-init", "--"]
CMD ["/usr/local/bin/node", "/app/dist/index.js"]

# ============================================================
# Metadata
# ============================================================
LABEL name="mpc-enclave-server" \
      version="1.0.0" \
      description="MPC two-party signing service for AWS Nitro Enclaves" \
      maintainer="your-email@example.com"
