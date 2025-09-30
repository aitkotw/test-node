#!/bin/bash

# View logs script for AWS Nitro Enclave
set -e

echo "📋 Viewing Nitro Enclave logs..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get enclave ID
ENCLAVE_ID=""
if [ -f "./enclave-runtime.json" ]; then
    ENCLAVE_ID=$(cat ./enclave-runtime.json | jq -r '.enclave_id' 2>/dev/null || echo "")
fi

# If no saved enclave ID, try to find running enclaves
if [ -z "${ENCLAVE_ID}" ] || [ "${ENCLAVE_ID}" = "null" ]; then
    echo -e "${YELLOW}Looking for running enclaves...${NC}"
    ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID' 2>/dev/null || echo "")
fi

if [ -z "${ENCLAVE_ID}" ] || [ "${ENCLAVE_ID}" = "null" ]; then
    echo -e "${RED}❌ No running enclave found${NC}"
    echo -e "${YELLOW}💡 Start the enclave first: ./scripts/start-enclave.sh${NC}"
    exit 1
fi

echo -e "${BLUE}Enclave ID: ${ENCLAVE_ID}${NC}"
echo -e "${YELLOW}Press Ctrl+C to exit log viewer${NC}"
echo "----------------------------------------"

# View logs in real-time
nitro-cli console --enclave-id ${ENCLAVE_ID}