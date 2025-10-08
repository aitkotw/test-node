# ============================================================
# AWS Nitro Enclave Node.js Application - Dockerfile
# ============================================================
# This Dockerfile creates an optimized image for running a
# Node.js application inside an AWS Nitro Enclave with vsock
# communication support.
# ============================================================

# ----------------------------------------------------
# STAGE 1: BUILD
# ----------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# ----------------------------------------------------
# STAGE 2: PRODUCTION
# ----------------------------------------------------
FROM node:20-alpine

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy compiled application from builder stage
COPY --from=builder /app/dist ./dist

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    VSOCK_PORT=5000

# Expose HTTP port (vsock is internal and doesn't need EXPOSE)
EXPOSE 3000

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Health check (optional - comment out if not needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
# Use absolute path for node binary (required for Nitro Enclaves)
ENTRYPOINT ["dumb-init", "--"]
CMD ["/usr/local/bin/node", "/app/dist/index.js"]
