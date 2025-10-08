#!/bin/bash

# Build script for creating AWS Nitro Enclave Image File (EIF)
# This script builds the Docker image and converts it to an EIF

set -e

echo "========================================="
echo "Building AWS Nitro Enclave Image"
echo "========================================="

# Configuration
IMAGE_NAME="enclave-service"
IMAGE_TAG="latest"
DOCKER_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
EIF_OUTPUT="enclave-service.eif"

# Step 1: Build Docker image
echo ""
echo "[1/3] Building Docker image..."
docker build -t ${DOCKER_IMAGE} .

if [ $? -eq 0 ]; then
    echo "✓ Docker image built successfully: ${DOCKER_IMAGE}"
else
    echo "✗ Failed to build Docker image"
    exit 1
fi

# Step 2: Convert Docker image to EIF
echo ""
echo "[2/3] Converting Docker image to Enclave Image File (EIF)..."
nitro-cli build-enclave \
    --docker-uri ${DOCKER_IMAGE} \
    --output-file ${EIF_OUTPUT}

if [ $? -eq 0 ]; then
    echo "✓ EIF created successfully: ${EIF_OUTPUT}"
else
    echo "✗ Failed to create EIF"
    exit 1
fi

# Step 3: Display EIF measurements (PCRs for attestation)
echo ""
echo "[3/3] EIF Measurements (PCRs):"
echo "These values are used for attestation and should be recorded securely"
echo ""

# Extract measurements from the build output (saved in the previous step)
if [ -f "${EIF_OUTPUT}" ]; then
    echo "EIF file size: $(du -h ${EIF_OUTPUT} | cut -f1)"
    echo ""
    echo "PCR values have been displayed above during the build."
    echo "Save these values for attestation verification!"
else
    echo "Warning: EIF file not found"
fi

echo ""
echo "========================================="
echo "Build Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Run the enclave with: ./run-enclave.sh"
echo "2. Test communication with: node parent-client.js"
echo ""
