#!/bin/bash

# Test script for AWS Nitro Enclave connectivity
set -e

echo "🧪 Testing Nitro Enclave connectivity..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
BASE_URL="http://localhost:3000"
TIMEOUT=10

# Function to test an endpoint
test_endpoint() {
    local endpoint=$1
    local expected_status=${2:-200}
    local description=$3

    echo -e "${YELLOW}Testing ${description}...${NC}"

    response=$(curl -s -w "%{http_code}" --max-time ${TIMEOUT} "${BASE_URL}${endpoint}" 2>/dev/null || echo "000")
    status_code="${response: -3}"
    body="${response%???}"

    if [ "${status_code}" = "${expected_status}" ]; then
        echo -e "${GREEN}✅ ${description} - Status: ${status_code}${NC}"
        if [ ! -z "${body}" ]; then
            echo -e "${BLUE}Response: ${body}${NC}"
        fi
        return 0
    else
        echo -e "${RED}❌ ${description} - Status: ${status_code}${NC}"
        if [ "${status_code}" = "000" ]; then
            echo -e "${RED}Connection failed - check if enclave is running${NC}"
        fi
        return 1
    fi
}

# Function to check enclave status
check_enclave_status() {
    echo -e "${YELLOW}Checking enclave status...${NC}"

    if command -v nitro-cli &> /dev/null; then
        ENCLAVE_COUNT=$(nitro-cli describe-enclaves | jq '. | length' 2>/dev/null || echo "0")

        if [ "${ENCLAVE_COUNT}" -gt 0 ]; then
            echo -e "${GREEN}✅ Found ${ENCLAVE_COUNT} running enclave(s)${NC}"
            nitro-cli describe-enclaves | jq '.[] | {EnclaveID, EnclaveCID, State, Flags}'
        else
            echo -e "${RED}❌ No running enclaves found${NC}"
            echo -e "${YELLOW}💡 Run ./scripts/start-enclave.sh to start the enclave${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ nitro-cli not found${NC}"
        return 1
    fi
}

# Function to check vsock proxy
check_vsock_proxy() {
    echo -e "${YELLOW}Checking vsock proxy...${NC}"

    if pgrep -f "vsock-proxy" > /dev/null; then
        echo -e "${GREEN}✅ Vsock proxy is running${NC}"
        return 0
    else
        echo -e "${RED}❌ Vsock proxy not running${NC}"
        return 1
    fi
}

# Main test sequence
echo -e "${BLUE}🔍 Pre-flight checks${NC}"
check_enclave_status || exit 1
check_vsock_proxy || echo -e "${YELLOW}⚠️  Vsock proxy not running - direct connection test${NC}"

echo -e "\n${BLUE}🌐 Testing HTTP endpoints${NC}"

# Test all endpoints
TOTAL_TESTS=0
PASSED_TESTS=0

# Root endpoint
TOTAL_TESTS=$((TOTAL_TESTS + 1))
test_endpoint "/" 200 "Root endpoint" && PASSED_TESTS=$((PASSED_TESTS + 1))

# Health endpoint
TOTAL_TESTS=$((TOTAL_TESTS + 1))
test_endpoint "/health" 200 "Health endpoint" && PASSED_TESTS=$((PASSED_TESTS + 1))

# Enclave status endpoint
TOTAL_TESTS=$((TOTAL_TESTS + 1))
test_endpoint "/api/enclave/status" 200 "Enclave status endpoint" && PASSED_TESTS=$((PASSED_TESTS + 1))

# Test POST endpoint
echo -e "${YELLOW}Testing POST endpoint...${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))
post_response=$(curl -s -w "%{http_code}" --max-time ${TIMEOUT} \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"data": "test input"}' \
    "${BASE_URL}/api/enclave/compute" 2>/dev/null || echo "000")

post_status="${post_response: -3}"
post_body="${post_response%???}"

if [ "${post_status}" = "200" ]; then
    echo -e "${GREEN}✅ POST endpoint - Status: ${post_status}${NC}"
    echo -e "${BLUE}Response: ${post_body}${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ POST endpoint - Status: ${post_status}${NC}"
fi

# Summary
echo -e "\n${BLUE}📊 Test Summary${NC}"
echo -e "Passed: ${PASSED_TESTS}/${TOTAL_TESTS}"

if [ ${PASSED_TESTS} -eq ${TOTAL_TESTS} ]; then
    echo -e "${GREEN}🎉 All tests passed! Enclave is working correctly.${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Check enclave configuration.${NC}"

    echo -e "\n${YELLOW}🔧 Troubleshooting tips:${NC}"
    echo "1. Ensure enclave is running: nitro-cli describe-enclaves"
    echo "2. Check enclave logs: nitro-cli console --enclave-id <ENCLAVE_ID>"
    echo "3. Verify vsock proxy: ps aux | grep vsock-proxy"
    echo "4. Restart enclave: ./scripts/stop-enclave.sh && ./scripts/start-enclave.sh"

    exit 1
fi