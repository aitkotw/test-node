#!/bin/bash

# Build script for AWS Nitro Enclave
set -e

echo "🔧 Building Nitro Enclave Image..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="enclave-service"
TAG="latest"
FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"

# Step 1: Build Docker image
echo -e "${YELLOW}Step 1: Building Docker image...${NC}"
docker build -t ${FULL_IMAGE_NAME} .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build Docker image${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Step 2: Convert Docker image to Enclave Image File (EIF)
echo -e "${YELLOW}Step 2: Converting to Enclave Image File...${NC}"

# Create output directory if it doesn't exist
mkdir -p ./enclave-images

# Build the EIF
nitro-cli build-enclave \
    --docker-uri ${FULL_IMAGE_NAME} \
    --output-file ./enclave-images/${IMAGE_NAME}.eif

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build enclave image${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Enclave image built successfully${NC}"

# Step 3: Get image measurements
echo -e "${YELLOW}Step 3: Getting image measurements...${NC}"
EIF_PATH="./enclave-images/${IMAGE_NAME}.eif"

# Extract measurements
MEASUREMENTS=$(nitro-cli describe-eif --eif-path ${EIF_PATH})
echo "${MEASUREMENTS}" > ./enclave-images/measurements.json

echo -e "${GREEN}✅ Image measurements saved to ./enclave-images/measurements.json${NC}"

# Step 4: Display build summary
echo -e "${YELLOW}📊 Build Summary:${NC}"
echo "Docker Image: ${FULL_IMAGE_NAME}"
echo "EIF File: ${EIF_PATH}"
echo "EIF Size: $(du -h ${EIF_PATH} | cut -f1)"

# Show measurements
echo -e "${YELLOW}🔐 Enclave Measurements:${NC}"
echo "${MEASUREMENTS}" | jq '.Measurements'

echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Run ./scripts/start-enclave.sh to start the enclave"
echo "2. Test connectivity with ./scripts/test-connection.sh"