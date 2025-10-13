#!/bin/bash
#
# run-enclave.sh - Run AWS Nitro Enclave
#
# This script:
# 1. Stops any running enclaves
# 2. Starts the enclave with specified resources
# 3. Sets up vsock forwarding (optional)
# 4. Monitors enclave status
#
# Prerequisites:
# - EIF file built (run build-eif.sh first)
# - Nitro Enclaves allocator service running
# - Sufficient CPU and memory allocated to enclaves
#
# Usage:
#   ./run-enclave.sh [OPTIONS]
#
# Options:
#   --memory MB       Memory in MB (default: 1024)
#   --cpus COUNT      Number of CPUs (default: 2)
#   --debug           Enable debug mode (console output)
#   --vsock-port PORT Parent vsock port (default: 5000)
#   --enclave-cid CID Enclave CID (default: 16)
#   --no-vsock        Skip vsock proxy setup
#

set -e
set -u

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EIF_NAME="enclave.eif"
EIF_PATH="${SCRIPT_DIR}/${EIF_NAME}"

# Default resource allocation
MEMORY_MB=1024
CPU_COUNT=2
DEBUG_MODE="false"

# vsock configuration
VSOCK_PROXY="true"
VSOCK_PORT=5000
ENCLAVE_CID=16
ENCLAVE_PORT=5000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check for nitro-cli
    if ! command -v nitro-cli &> /dev/null; then
        log_error "nitro-cli not found. Install AWS Nitro Enclaves CLI."
        exit 1
    fi

    # Check if EIF exists
    if [ ! -f "$EIF_PATH" ]; then
        log_error "EIF not found: $EIF_PATH"
        log_info "Run ./build-eif.sh first to build the enclave image"
        exit 1
    fi

    # Check nitro-enclaves-allocator service
    if ! systemctl is-active --quiet nitro-enclaves-allocator.service; then
        log_warn "nitro-enclaves-allocator service is not running"
        log_info "Starting service..."
        sudo systemctl start nitro-enclaves-allocator.service || {
            log_error "Failed to start nitro-enclaves-allocator service"
            exit 1
        }
    fi

    # Check available resources
    local available_memory=$(nitro-cli describe-enclaves | jq -r '.[] | .MemoryMiB' | awk '{sum+=$1} END {print sum}')
    local available_cpus=$(nitro-cli describe-enclaves | jq -r '.[] | .CPUCount' | awk '{sum+=$1} END {print sum}')

    log_info "Available resources:"
    log_info "  Memory: ${available_memory:-0} MB (requesting ${MEMORY_MB} MB)"
    log_info "  CPUs: ${available_cpus:-0} (requesting ${CPU_COUNT})"

    log_info "Prerequisites satisfied"
}

stop_existing_enclaves() {
    log_info "Checking for existing enclaves..."

    # Get list of running enclaves
    local enclave_ids=$(nitro-cli describe-enclaves 2>/dev/null | jq -r '.[].EnclaveID' || echo "")

    if [ -n "$enclave_ids" ]; then
        log_warn "Found running enclaves. Stopping them..."

        for enclave_id in $enclave_ids; do
            log_info "Stopping enclave: $enclave_id"
            nitro-cli terminate-enclave --enclave-id "$enclave_id" || {
                log_warn "Failed to stop enclave $enclave_id"
            }
        done

        sleep 2
    else
        log_info "No existing enclaves running"
    fi
}

start_enclave() {
    log_info "Starting enclave..."
    log_info "Configuration:"
    log_info "  EIF: $EIF_PATH"
    log_info "  Memory: ${MEMORY_MB} MB"
    log_info "  CPUs: ${CPU_COUNT}"
    log_info "  CID: ${ENCLAVE_CID}"
    log_info "  Debug Mode: ${DEBUG_MODE}"

    # Build nitro-cli command
    local cmd="nitro-cli run-enclave"
    cmd="${cmd} --eif-path ${EIF_PATH}"
    cmd="${cmd} --memory ${MEMORY_MB}"
    cmd="${cmd} --cpu-count ${CPU_COUNT}"
    cmd="${cmd} --enclave-cid ${ENCLAVE_CID}"

    if [ "$DEBUG_MODE" = "true" ]; then
        log_warn "Debug mode enabled - console output will be visible"
        cmd="${cmd} --debug-mode"
    fi

    # Run the enclave
    log_debug "Executing: $cmd"
    local output=$(eval $cmd 2>&1)

    if [ $? -eq 0 ]; then
        log_info "Enclave started successfully"

        # Extract enclave ID
        ENCLAVE_ID=$(echo "$output" | jq -r '.EnclaveID')
        log_info "Enclave ID: $ENCLAVE_ID"

        # Wait for enclave to initialize
        log_info "Waiting for enclave to initialize..."
        sleep 3

        return 0
    else
        log_error "Failed to start enclave"
        echo "$output"
        return 1
    fi
}

setup_vsock_forwarding() {
    if [ "$VSOCK_PROXY" = "false" ]; then
        log_info "Skipping vsock forwarding (--no-vsock specified)"
        return 0
    fi

    log_info "Setting up vsock forwarding..."
    log_info "  Parent port: ${VSOCK_PORT}"
    log_info "  Enclave CID: ${ENCLAVE_CID}"
    log_info "  Enclave port: ${ENCLAVE_PORT}"

    # Check if socat is installed
    if ! command -v socat &> /dev/null; then
        log_warn "socat not found. Install with: sudo yum install -y socat"
        log_info "Skipping vsock forwarding setup"
        return 0
    fi

    # Check if port is already in use
    if lsof -i :${VSOCK_PORT} &> /dev/null; then
        log_warn "Port ${VSOCK_PORT} is already in use"
        log_info "Checking if it's our vsock proxy..."

        local pid=$(lsof -t -i :${VSOCK_PORT} || echo "")
        if [ -n "$pid" ]; then
            local cmd=$(ps -p $pid -o comm= || echo "")
            if [[ "$cmd" == *"socat"* ]]; then
                log_info "Existing vsock proxy found (PID: $pid). Restarting..."
                kill $pid 2>/dev/null || sudo kill $pid
                sleep 1
            else
                log_error "Port ${VSOCK_PORT} is occupied by: $cmd (PID: $pid)"
                log_info "Please free the port or use a different --vsock-port"
                return 1
            fi
        fi
    fi

    # Start vsock proxy in background
    log_info "Starting vsock proxy with socat..."

    # Save PID to file for cleanup
    VSOCK_PID_FILE="/tmp/vsock-proxy-${VSOCK_PORT}.pid"

    nohup socat TCP-LISTEN:${VSOCK_PORT},reuseaddr,fork VSOCK-CONNECT:${ENCLAVE_CID}:${ENCLAVE_PORT} \
        > /tmp/vsock-proxy.log 2>&1 &

    local socat_pid=$!
    echo $socat_pid > "$VSOCK_PID_FILE"

    sleep 1

    # Verify socat is running
    if ps -p $socat_pid > /dev/null; then
        log_info "vsock proxy started successfully (PID: $socat_pid)"
        log_info "Parent proxy can now connect to: http://127.0.0.1:${VSOCK_PORT}"
    else
        log_error "Failed to start vsock proxy"
        return 1
    fi

    return 0
}

verify_enclave_health() {
    log_info "Verifying enclave health..."

    # Wait a bit for enclave to fully start
    sleep 2

    # Check enclave status
    local status=$(nitro-cli describe-enclaves 2>/dev/null | jq -r '.[0].State' || echo "UNKNOWN")

    if [ "$status" = "RUNNING" ]; then
        log_info "Enclave is running"
    else
        log_warn "Enclave state: $status"
    fi

    # Test HTTP endpoint if vsock forwarding is enabled
    if [ "$VSOCK_PROXY" = "true" ]; then
        log_info "Testing enclave HTTP endpoint..."

        for i in {1..10}; do
            if curl -s -f "http://127.0.0.1:${VSOCK_PORT}/v1/health" > /dev/null 2>&1; then
                log_info "Enclave HTTP endpoint is responding"
                local health_response=$(curl -s "http://127.0.0.1:${VSOCK_PORT}/v1/health")
                echo "Health check response: $health_response"
                return 0
            fi

            log_debug "Attempt $i/10: Waiting for enclave to respond..."
            sleep 2
        done

        log_warn "Enclave HTTP endpoint not responding"
        log_info "Check enclave console with: nitro-cli console --enclave-id $ENCLAVE_ID"
    fi

    return 0
}

show_enclave_info() {
    echo ""
    log_info "Enclave Information"
    echo "=============================================="

    nitro-cli describe-enclaves | jq -r '.[] | "Enclave ID:  \(.EnclaveID)\nState:       \(.State)\nMemory:      \(.MemoryMiB) MB\nCPUs:        \(.CPUCount)\nCID:         \(.EnclaveCID)"'

    echo "=============================================="
    echo ""

    if [ "$VSOCK_PROXY" = "true" ]; then
        log_info "Access Information:"
        echo "  Enclave Endpoint: http://127.0.0.1:${VSOCK_PORT}"
        echo "  Parent Proxy should connect to: http://127.0.0.1:${VSOCK_PORT}"
        echo ""
    fi

    log_info "Management Commands:"
    echo "  View console:     nitro-cli console --enclave-id ${ENCLAVE_ID}"
    echo "  Describe enclave: nitro-cli describe-enclaves"
    echo "  Stop enclave:     nitro-cli terminate-enclave --enclave-id ${ENCLAVE_ID}"
    echo "  View logs:        tail -f /tmp/vsock-proxy.log"
    echo ""
}

cleanup() {
    log_info "Cleaning up..."

    # Remove PID file
    if [ -f "$VSOCK_PID_FILE" ]; then
        rm -f "$VSOCK_PID_FILE"
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --memory)
            MEMORY_MB="$2"
            shift 2
            ;;
        --cpus)
            CPU_COUNT="$2"
            shift 2
            ;;
        --debug)
            DEBUG_MODE="true"
            shift
            ;;
        --vsock-port)
            VSOCK_PORT="$2"
            shift 2
            ;;
        --enclave-cid)
            ENCLAVE_CID="$2"
            shift 2
            ;;
        --no-vsock)
            VSOCK_PROXY="false"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --memory MB         Memory allocation in MB (default: 1024)"
            echo "  --cpus COUNT        CPU count (default: 2)"
            echo "  --debug             Enable debug mode (console output)"
            echo "  --vsock-port PORT   Parent vsock port (default: 5000)"
            echo "  --enclave-cid CID   Enclave CID (default: 16)"
            echo "  --no-vsock          Skip vsock proxy setup"
            echo "  -h, --help          Show this help"
            echo ""
            echo "Example:"
            echo "  $0                        # Default settings"
            echo "  $0 --memory 2048 --cpus 4 # More resources"
            echo "  $0 --debug                # Debug mode"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# ============================================================================
# Main Execution
# ============================================================================

trap cleanup EXIT

log_info "Starting Nitro Enclave..."
echo ""

# Step 1: Check prerequisites
check_prerequisites
echo ""

# Step 2: Stop existing enclaves
stop_existing_enclaves
echo ""

# Step 3: Start enclave
start_enclave || exit 1
echo ""

# Step 4: Setup vsock forwarding
setup_vsock_forwarding || {
    log_warn "vsock forwarding setup failed (non-fatal)"
}
echo ""

# Step 5: Verify health
verify_enclave_health
echo ""

# Step 6: Show info
show_enclave_info

log_info "Enclave is running!"
log_info "To stop: nitro-cli terminate-enclave --enclave-id ${ENCLAVE_ID}"

exit 0
