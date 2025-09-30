#!/bin/bash

# Stop script for AWS Nitro Enclave
set -e

echo "🛑 Stopping Nitro Enclave..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Stop vsock proxy
echo -e "${YELLOW}Stopping vsock proxy...${NC}"
if [ -f "./vsock-proxy.pid" ]; then
    PROXY_PID=$(cat ./vsock-proxy.pid)
    if ps -p ${PROXY_PID} > /dev/null 2>&1; then
        kill ${PROXY_PID}
        echo -e "${GREEN}✅ Vsock proxy stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  Vsock proxy was not running${NC}"
    fi
    rm -f ./vsock-proxy.pid
else
    # Fallback: kill all vsock-proxy processes
    pkill vsock-proxy 2>/dev/null || true
fi

# Get enclave ID
ENCLAVE_ID=""
if [ -f "./enclave-runtime.json" ]; then
    ENCLAVE_ID=$(cat ./enclave-runtime.json | jq -r '.enclave_id' 2>/dev/null || echo "")
fi

# If no saved enclave ID, try to find running enclaves
if [ -z "${ENCLAVE_ID}" ]; then
    echo -e "${YELLOW}Looking for running enclaves...${NC}"
    ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID' 2>/dev/null || echo "")
fi

# Stop the enclave
if [ ! -z "${ENCLAVE_ID}" ] && [ "${ENCLAVE_ID}" != "null" ]; then
    echo -e "${YELLOW}Stopping enclave: ${ENCLAVE_ID}${NC}"
    nitro-cli terminate-enclave --enclave-id ${ENCLAVE_ID}

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Enclave stopped successfully${NC}"
    else
        echo -e "${RED}❌ Failed to stop enclave${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  No running enclave found${NC}"
fi

# Cleanup runtime files
rm -f ./enclave-runtime.json

echo -e "${GREEN}🎉 Cleanup completed!${NC}"