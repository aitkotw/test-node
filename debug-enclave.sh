#!/bin/bash

# Debug script for AWS Nitro Enclave
set -e

echo "🔍 Debugging Nitro Enclave..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Function to check system requirements
check_system() {
    echo -e "${PURPLE}=== System Requirements ===${NC}"

    # Check if running on EC2 with Nitro support
    if [ -f /sys/devices/virtual/misc/nitro_enclaves/dev ]; then
        echo -e "${GREEN}✅ Nitro Enclaves device found${NC}"
    else
        echo -e "${RED}❌ Nitro Enclaves device not found${NC}"
        echo -e "${YELLOW}💡 Ensure you're running on an EC2 instance with Nitro Enclaves support${NC}"
    fi

    # Check nitro-cli installation
    if command -v nitro-cli &> /dev/null; then
        NITRO_VERSION=$(nitro-cli --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✅ nitro-cli installed: ${NITRO_VERSION}${NC}"
    else
        echo -e "${RED}❌ nitro-cli not found${NC}"
        echo -e "${YELLOW}💡 Install with: sudo amazon-linux-extras install aws-nitro-enclaves-cli${NC}"
    fi

    # Check Docker
    if command -v docker &> /dev/null; then
        if docker info &> /dev/null; then
            echo -e "${GREEN}✅ Docker is running${NC}"
        else
            echo -e "${RED}❌ Docker is not running${NC}"
            echo -e "${YELLOW}💡 Start Docker: sudo systemctl start docker${NC}"
        fi
    else
        echo -e "${RED}❌ Docker not found${NC}"
    fi

    # Check allocator service
    if systemctl is-active --quiet nitro-enclaves-allocator; then
        echo -e "${GREEN}✅ Nitro Enclaves Allocator service is running${NC}"
    else
        echo -e "${RED}❌ Nitro Enclaves Allocator service not running${NC}"
        echo -e "${YELLOW}💡 Start with: sudo systemctl start nitro-enclaves-allocator${NC}"
    fi

    # Check vsock-proxy
    if command -v vsock-proxy &> /dev/null; then
        echo -e "${GREEN}✅ vsock-proxy found${NC}"
    else
        echo -e "${RED}❌ vsock-proxy not found${NC}"
        echo -e "${YELLOW}💡 Install with: sudo amazon-linux-extras install aws-nitro-enclaves-cli${NC}"
    fi
}

# Function to check resource allocation
check_resources() {
    echo -e "\n${PURPLE}=== Resource Allocation ===${NC}"

    # Check CPU allocation
    if [ -f /sys/module/nitro_enclaves/parameters/ne_cpus ]; then
        NE_CPUS=$(cat /sys/module/nitro_enclaves/parameters/ne_cpus)
        echo -e "${BLUE}Enclave CPUs: ${NE_CPUS}${NC}"
    fi

    # Check memory allocation
    if [ -f /sys/module/nitro_enclaves/parameters/ne_mem_regions ]; then
        NE_MEM=$(cat /sys/module/nitro_enclaves/parameters/ne_mem_regions)
        echo -e "${BLUE}Enclave Memory Regions: ${NE_MEM}${NC}"
    fi

    # Show current allocations
    if command -v nitro-cli &> /dev/null; then
        echo -e "${BLUE}Available resources:${NC}"
        nitro-cli describe-eif --eif-path ./enclave-images/enclave-service.eif 2>/dev/null || echo "EIF not found"
    fi
}

# Function to check running enclaves
check_enclaves() {
    echo -e "\n${PURPLE}=== Running Enclaves ===${NC}"

    if command -v nitro-cli &> /dev/null; then
        ENCLAVES=$(nitro-cli describe-enclaves 2>/dev/null || echo "[]")
        ENCLAVE_COUNT=$(echo "${ENCLAVES}" | jq '. | length' 2>/dev/null || echo "0")

        if [ "${ENCLAVE_COUNT}" -gt 0 ]; then
            echo -e "${GREEN}Found ${ENCLAVE_COUNT} running enclave(s):${NC}"
            echo "${ENCLAVES}" | jq '.[] | {EnclaveID, EnclaveCID, State, Flags, CPUCount, MemoryMiB}'
        else
            echo -e "${YELLOW}No running enclaves found${NC}"
        fi
    fi
}

# Function to check network connectivity
check_network() {
    echo -e "\n${PURPLE}=== Network Connectivity ===${NC}"

    # Check if vsock proxy is running
    if pgrep -f "vsock-proxy" > /dev/null; then
        PROXY_PID=$(pgrep -f "vsock-proxy")
        echo -e "${GREEN}✅ Vsock proxy running (PID: ${PROXY_PID})${NC}"

        # Show proxy details
        echo -e "${BLUE}Proxy process:${NC}"
        ps aux | grep vsock-proxy | grep -v grep
    else
        echo -e "${RED}❌ Vsock proxy not running${NC}"
    fi

    # Test local port binding
    if netstat -tulpn 2>/dev/null | grep -q ":3000"; then
        echo -e "${GREEN}✅ Port 3000 is in use${NC}"
        netstat -tulpn | grep ":3000"
    else
        echo -e "${YELLOW}⚠️  Port 3000 not in use${NC}"
    fi

    # Test connectivity
    echo -e "${BLUE}Testing connectivity:${NC}"
    timeout 5 curl -s http://localhost:3000/health >/dev/null 2>&1 && \
        echo -e "${GREEN}✅ HTTP connection successful${NC}" || \
        echo -e "${RED}❌ HTTP connection failed${NC}"
}

# Function to check Docker images
check_docker() {
    echo -e "\n${PURPLE}=== Docker Images ===${NC}"

    if docker images | grep -q "enclave-service"; then
        echo -e "${GREEN}✅ Enclave service Docker image found${NC}"
        docker images | grep enclave-service
    else
        echo -e "${RED}❌ Enclave service Docker image not found${NC}"
        echo -e "${YELLOW}💡 Build with: npm run enclave:build${NC}"
    fi

    # Check EIF file
    if [ -f "./enclave-images/enclave-service.eif" ]; then
        EIF_SIZE=$(du -h ./enclave-images/enclave-service.eif | cut -f1)
        echo -e "${GREEN}✅ EIF file found (${EIF_SIZE})${NC}"
    else
        echo -e "${RED}❌ EIF file not found${NC}"
        echo -e "${YELLOW}💡 Build with: npm run enclave:build${NC}"
    fi
}

# Function to show logs
show_recent_logs() {
    echo -e "\n${PURPLE}=== Recent Logs ===${NC}"

    ENCLAVE_ID=""
    if [ -f "./enclave-runtime.json" ]; then
        ENCLAVE_ID=$(cat ./enclave-runtime.json | jq -r '.enclave_id' 2>/dev/null || echo "")
    fi

    if [ ! -z "${ENCLAVE_ID}" ] && [ "${ENCLAVE_ID}" != "null" ]; then
        echo -e "${BLUE}Recent enclave logs (last 20 lines):${NC}"
        echo "----------------------------------------"
        timeout 5 nitro-cli console --enclave-id ${ENCLAVE_ID} 2>/dev/null | tail -20 || \
            echo -e "${YELLOW}Could not retrieve logs${NC}"
    else
        echo -e "${YELLOW}No running enclave to show logs for${NC}"
    fi
}

# Function to provide troubleshooting suggestions
troubleshooting_tips() {
    echo -e "\n${PURPLE}=== Troubleshooting Tips ===${NC}"

    echo -e "${YELLOW}Common issues and solutions:${NC}"
    echo "1. 'Empty reply from server':"
    echo "   - Check if app binds to 0.0.0.0 (not 127.0.0.1)"
    echo "   - Verify vsock proxy is running"
    echo "   - Check enclave logs for errors"
    echo ""
    echo "2. 'Cannot allocate memory':"
    echo "   - Reduce memory_mib in enclave-config.json"
    echo "   - Check available memory: free -h"
    echo ""
    echo "3. 'Permission denied':"
    echo "   - Run as root: sudo ./scripts/start-enclave.sh"
    echo "   - Check Docker permissions"
    echo ""
    echo "4. 'Connection refused':"
    echo "   - Verify port 3000 is not blocked"
    echo "   - Check if another service uses port 3000"
    echo ""
    echo -e "${BLUE}Useful commands:${NC}"
    echo "• npm run enclave:build     - Build enclave image"
    echo "• npm run enclave:start     - Start enclave"
    echo "• npm run enclave:test      - Test connectivity"
    echo "• npm run enclave:logs      - View live logs"
    echo "• npm run enclave:stop      - Stop enclave"
}

# Main debug sequence
echo -e "${BLUE}🔍 Starting comprehensive debug check...${NC}\n"

check_system
check_resources
check_enclaves
check_network
check_docker
show_recent_logs
troubleshooting_tips

echo -e "\n${GREEN}🎉 Debug check completed!${NC}"