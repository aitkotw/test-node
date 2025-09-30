#!/bin/bash

# Start script for AWS Nitro Enclave
set -e

echo "🚀 Starting Nitro Enclave..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration from enclave-config.json
CPU_COUNT=2
MEMORY_MIB=512
EIF_PATH="./enclave-images/enclave-service.eif"
ENCLAVE_NAME="enclave-service"

# Check if EIF exists
if [ ! -f "${EIF_PATH}" ]; then
    echo -e "${RED}❌ Enclave image file not found: ${EIF_PATH}${NC}"
    echo -e "${YELLOW}Please run ./scripts/build-enclave.sh first${NC}"
    exit 1
fi

# Stop existing enclave if running
echo -e "${YELLOW}Checking for existing enclaves...${NC}"
EXISTING_ENCLAVE=$(nitro-cli describe-enclaves | jq -r '.[] | select(.EnclaveName == "'${ENCLAVE_NAME}'") | .EnclaveID' 2>/dev/null || echo "")

if [ ! -z "${EXISTING_ENCLAVE}" ]; then
    echo -e "${YELLOW}Stopping existing enclave: ${EXISTING_ENCLAVE}${NC}"
    nitro-cli terminate-enclave --enclave-id ${EXISTING_ENCLAVE}
    sleep 2
fi

# Start the enclave
echo -e "${YELLOW}Starting new enclave...${NC}"
ENCLAVE_OUTPUT=$(nitro-cli run-enclave \
    --cpu-count ${CPU_COUNT} \
    --memory ${MEMORY_MIB} \
    --eif-path ${EIF_PATH} \
    --enclave-name ${ENCLAVE_NAME} \
    --debug-mode)

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start enclave${NC}"
    exit 1
fi

# Extract enclave ID
ENCLAVE_ID=$(echo "${ENCLAVE_OUTPUT}" | jq -r '.EnclaveID')
ENCLAVE_CID=$(echo "${ENCLAVE_OUTPUT}" | jq -r '.EnclaveCID')

echo -e "${GREEN}✅ Enclave started successfully!${NC}"
echo -e "${BLUE}Enclave ID: ${ENCLAVE_ID}${NC}"
echo -e "${BLUE}Enclave CID: ${ENCLAVE_CID}${NC}"

# Save enclave info for other scripts
echo "{\"enclave_id\": \"${ENCLAVE_ID}\", \"enclave_cid\": ${ENCLAVE_CID}}" > ./enclave-runtime.json

# Wait for enclave to initialize
echo -e "${YELLOW}Waiting for enclave to initialize...${NC}"
sleep 5

# Check enclave status
echo -e "${YELLOW}Checking enclave status...${NC}"
nitro-cli describe-enclaves

# Set up vsock proxy for external access
echo -e "${YELLOW}Setting up vsock proxy...${NC}"
# Kill existing vsock-proxy if running
pkill vsock-proxy 2>/dev/null || true

# Start vsock proxy in background
vsock-proxy 3000 vsock-cid:${ENCLAVE_CID} 3000 &
PROXY_PID=$!

echo "${PROXY_PID}" > ./vsock-proxy.pid
echo -e "${GREEN}✅ Vsock proxy started (PID: ${PROXY_PID})${NC}"

echo -e "${GREEN}🎉 Enclave setup completed!${NC}"
echo -e "${YELLOW}📋 Summary:${NC}"
echo "Enclave ID: ${ENCLAVE_ID}"
echo "Enclave CID: ${ENCLAVE_CID}"
echo "Proxy PID: ${PROXY_PID}"
echo "Service URL: http://localhost:3000"
echo ""
echo -e "${YELLOW}💡 Useful commands:${NC}"
echo "• View logs: nitro-cli console --enclave-id ${ENCLAVE_ID}"
echo "• Test connection: ./scripts/test-connection.sh"
echo "• Stop enclave: ./scripts/stop-enclave.sh"