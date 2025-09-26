# ----------------------------------------------------
# 1. BUILD STAGE (to install dependencies)
# ----------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY . .

# ----------------------------------------------------
# 2. PRODUCTION STAGE (final image)
# ----------------------------------------------------
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
EXPOSE 3000

# Define the command to run your app
# FIX: Replaced 'node' with the absolute path '/usr/local/bin/node'.
# This is necessary because the enclave's minimal environment
# often can't resolve executables using the system's PATH.
CMD ["/usr/local/bin/node", "/app/dist/index.js"]