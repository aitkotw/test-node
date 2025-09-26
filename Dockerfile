# ----------------------------------------------------
# 1. BUILD STAGE (to install dependencies)
# ----------------------------------------------------
# Use a slimmed-down Node.js image as the base for building
FROM node:20-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first
# This allows Docker to cache the dependency installation layer
# as long as these files don't change.
COPY package*.json ./

# Install dependencies
# Using --only=production skips devDependencies, reducing image size
RUN npm install --only=production

# Copy the rest of the application source code
COPY . .

# ----------------------------------------------------
# 2. PRODUCTION STAGE (final image)
# ----------------------------------------------------
# Start a fresh, minimal image for the final production container
# This is crucial for security and small size (Multi-stage build)
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy only the necessary files from the builder stage
# This includes the app code and installed node_modules
COPY --from=builder /app .

# Expose the port your app runs on
EXPOSE 3000

# Define the command to run your app
# Use the 'node' command directly, not 'npm start', for signal handling
CMD ["node", "dist/index.js"]