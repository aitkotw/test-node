# ----------------------------------------------------
# 1) BUILD STAGE
# ----------------------------------------------------
FROM amazonlinux:2023 AS builder

# Install Node.js + npm (from distro repos) and Nitro Enclaves CLI for vsock-proxy
# If you need Node 20 specifically, you can also curl/install from nodesource; 
# the AL2023 repo usually provides a recent enough Node.
RUN dnf -y update && \
    dnf -y install nodejs npm aws-nitro-enclaves-cli jq && \
    dnf clean all

WORKDIR /app

# Install only prod deps
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# (Optional) Build step if you transpile to /dist
# RUN npm run build


# ----------------------------------------------------
# 2) RUNTIME STAGE (FINAL IMAGE)
# ----------------------------------------------------
FROM amazonlinux:2023

# Install runtime needs: node + vsock-proxy
RUN dnf -y update && \
    dnf -y install nodejs aws-nitro-enclaves-cli && \
    dnf clean all

WORKDIR /app

# Copy app (with node_modules from builder)
COPY --from=builder /app /app

# You don’t need to expose ports for enclaves, but keeping for clarity
EXPOSE 3000

# IMPORTANT:
# Your app should listen on 127.0.0.1:3000 inside the enclave.
# And you should start a vsock listener that forwards vsock:3000 -> tcp:127.0.0.1:3000.
# The simplest is to use an npm script with "concurrently" to run both processes.
#
# Example package.json scripts:
#   "scripts": {
#     "start": "concurrently -k -n NODE,VSOCK \"/usr/bin/node /app/dist/index.js\" \"vsock-proxy 3000 127.0.0.1 3000\""
#   },
#   "devDependencies": { "concurrently": "^9.0.0" }
#
# If you don't want to add "concurrently", you can start a tiny sh wrapper instead.

# Option A: Use npm start (recommended). Make sure your package.json has the start script above.
CMD ["npm", "start"]

# Option B: If you prefer no npm script, uncomment this direct form:
# CMD ["/bin/sh", "-lc", "/usr/bin/node /app/dist/index.js & exec vsock-proxy 3000 127.0.0.1 3000"]
