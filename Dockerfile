# ----------------------------------------------------
# 1. BUILD STAGE (to install dependencies and compile TypeScript)
# ----------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for compilation)
RUN npm install

# Copy source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# ----------------------------------------------------
# 2. PRODUCTION STAGE (final image)
# ----------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy any other necessary files (if needed)
COPY --from=builder /app/package.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Define the command to run your app
# Use absolute path for enclave compatibility
CMD ["/usr/local/bin/node", "/app/dist/index.js"]