# ----------------------------------------------------
# 1. BUILD STAGE (to install dependencies and build the app)
# ----------------------------------------------------
FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS builder

# Clean DNF cache and update system
RUN dnf clean all && \
    dnf update -y --allowerasing

# Install curl, build tools, and dependencies
RUN dnf install -y --allowerasing curl gcc-c++ make || \
    echo "Warning: Failed to install some dependencies. Check package conflicts."

# Add NodeSource repository for Node.js 20
RUN curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -

# Install Node.js
RUN dnf install -y --allowerasing nodejs || \
    echo "Warning: Node.js installation failed. Verify NodeSource repo compatibility."

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the app (assuming TypeScript or a build step; adjust if no build needed)
RUN npm run build || \
    echo "Warning: Build failed. Ensure 'build' script is defined in package.json."

# ----------------------------------------------------
# 2. PRODUCTION STAGE (final image)
# ----------------------------------------------------
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Clean DNF cache and update system
RUN dnf clean all && \
    dnf update -y --allowerasing

# Install curl for NodeSource setup
RUN dnf install -y --allowerasing curl

# Add NodeSource repository for Node.js 20
RUN curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -

# Install Node.js
RUN dnf install -y --allowerasing nodejs

# Install aws-nitro-enclaves-vsock-proxy manually (since not in default repos)
# Replace with the correct RPM URL for your region/architecture
RUN curl -o /tmp/aws-nitro-enclaves-vsock-proxy.rpm \
    https://aws-nitro-enclaves-cli.s3.amazonaws.com/latest/aws-nitro-enclaves-vsock-proxy.rpm && \
    dnf install -y /tmp/aws-nitro-enclaves-vsock-proxy.rpm || \
    echo "Warning: Failed to install aws-nitro-enclaves-vsock-proxy. Ensure Nitro Enclaves setup or remove if not needed."

# Clean up
RUN rm -f /tmp/aws-nitro-enclaves-vsock-proxy.rpm

# Set working directory
WORKDIR /app

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm install --production

# Expose port for the app
EXPOSE 3000

# Environment variables for port configuration
ENV APP_PORT=3000
ENV VSOCK_PORT=3000

# Command to run the app with vsock-proxy for Nitro Enclaves
# Fallback to node if vsock-proxy is not installed
CMD ["/bin/sh", "-c", "if [ -x /usr/bin/vsock-proxy ]; then vsock-proxy 0.0.0.0:${VSOCK_PORT} 127.0.0.1:${APP_PORT} -- /usr/bin/node /app/dist/index.js; else node /app/dist/index.js; fi"]