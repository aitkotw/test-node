#!/bin/bash
#
# build-eif.sh - Build AWS Nitro Enclave Image File (EIF)
#
# This script:
# 1. Builds a Docker image from the Dockerfile
# 2. Converts the Docker image to an EIF using nitro-cli
# 3. Outputs PCR measurements for attestation
#
# Prerequisites:
# - AWS Nitro Enclaves CLI installed
# - Docker installed and running
# - Sufficient permissions to run docker and nitro-cli
#
# Usage:
#   ./build-eif.sh [--mock-mode]
#
# Options:
#   --mock-mode     Build with MOCK_MPC=true for testing
#   --production    Build with production settings (default)
#
# Output:
#   - enclave.eif           Enclave image file
#   - enclave-pcr.json      PCR measurements for attestation
#

set -e  # Exit on error
set -u  # Exit on undefined variable

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="mpc-enclave-server"
IMAGE_TAG="latest"
EIF_NAME="enclave.eif"
PCR_OUTPUT="enclave-pcr.json"

# Default settings
MOCK_MODE="false"
MEMORY_MB=1024
CPU_COUNT=2
DEBUG_MODE="false"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check for Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi

    # Check for nitro-cli
    if ! command -v nitro-cli &> /dev/null; then
        log_error "nitro-cli is not installed. Please install AWS Nitro Enclaves CLI."
        log_info "Install with: sudo amazon-linux-extras install aws-nitro-enclaves-cli"
        exit 1
    fi

    log_info "All prerequisites satisfied."
}

build_docker_image() {
    log_info "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"

    # Build from project root (not enclave directory)
    cd "$PROJECT_ROOT"

    # Build with appropriate settings
    if [ "$MOCK_MODE" = "true" ]; then
        log_warn "Building in MOCK MODE (for testing only)"
        docker build \
            --build-arg MOCK_MPC=true \
            --build-arg KEYSTORE_TYPE=memory \
            -t "${IMAGE_NAME}:${IMAGE_TAG}" \
            -f Dockerfile \
            .
    else
        log_info "Building in PRODUCTION MODE"
        docker build \
            --build-arg MOCK_MPC=false \
            --build-arg KEYSTORE_TYPE=file \
            -t "${IMAGE_NAME}:${IMAGE_TAG}" \
            -f Dockerfile \
            .
    fi

    if [ $? -eq 0 ]; then
        log_info "Docker image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
    else
        log_error "Docker build failed"
        exit 1
    fi
}

build_enclave_image() {
    log_info "Converting Docker image to Enclave Image File (EIF)..."

    # Output EIF to enclave directory
    cd "$SCRIPT_DIR"

    # Remove old EIF if exists
    if [ -f "$EIF_NAME" ]; then
        log_warn "Removing existing $EIF_NAME"
        rm -f "$EIF_NAME"
    fi

    # Build EIF with nitro-cli
    if [ "$DEBUG_MODE" = "true" ]; then
        log_warn "Building with debug mode enabled"
        nitro-cli build-enclave \
            --docker-uri "${IMAGE_NAME}:${IMAGE_TAG}" \
            --output-file "$EIF_NAME" \
            --debug-mode
    else
        nitro-cli build-enclave \
            --docker-uri "${IMAGE_NAME}:${IMAGE_TAG}" \
            --output-file "$EIF_NAME"
    fi

    if [ $? -eq 0 ]; then
        log_info "Enclave image built successfully: $EIF_NAME"
    else
        log_error "EIF build failed"
        exit 1
    fi
}

extract_pcr_measurements() {
    log_info "Extracting PCR measurements..."

    cd "$SCRIPT_DIR"

    # Get PCR measurements from the EIF
    nitro-cli describe-eif --eif-path "$EIF_NAME" > "$PCR_OUTPUT"

    if [ $? -eq 0 ]; then
        log_info "PCR measurements saved to: $PCR_OUTPUT"

        # Display PCR values (important for attestation)
        echo ""
        log_info "PCR Measurements (for attestation verification):"
        echo "=================================================="

        # Extract PCR0, PCR1, PCR2 using jq if available
        if command -v jq &> /dev/null; then
            PCR0=$(jq -r '.Measurements.PCR0' "$PCR_OUTPUT")
            PCR1=$(jq -r '.Measurements.PCR1' "$PCR_OUTPUT")
            PCR2=$(jq -r '.Measurements.PCR2' "$PCR_OUTPUT")

            echo "PCR0 (Enclave Image): $PCR0"
            echo "PCR1 (Kernel):        $PCR1"
            echo "PCR2 (Application):   $PCR2"
        else
            cat "$PCR_OUTPUT"
        fi

        echo "=================================================="
        echo ""
        log_warn "IMPORTANT: Store these PCR values securely."
        log_warn "Clients must verify these values during attestation."
    else
        log_error "Failed to extract PCR measurements"
        exit 1
    fi
}

display_summary() {
    echo ""
    log_info "Build Summary"
    echo "=============================================="
    echo "Docker Image:    ${IMAGE_NAME}:${IMAGE_TAG}"
    echo "EIF File:        ${SCRIPT_DIR}/${EIF_NAME}"
    echo "PCR File:        ${SCRIPT_DIR}/${PCR_OUTPUT}"
    echo "Mock Mode:       ${MOCK_MODE}"
    echo "Memory:          ${MEMORY_MB} MB (configurable in run-enclave.sh)"
    echo "CPUs:            ${CPU_COUNT} (configurable in run-enclave.sh)"
    echo "=============================================="
    echo ""

    if [ "$MOCK_MODE" = "true" ]; then
        log_warn "WARNING: This image was built in MOCK MODE"
        log_warn "Do NOT use for production!"
    else
        log_info "Next steps:"
        echo "  1. Review PCR measurements in ${PCR_OUTPUT}"
        echo "  2. Run the enclave with: ./run-enclave.sh"
        echo "  3. Verify attestation from clients"
        echo "  4. Set up vsock forwarding on parent instance"
    fi
}

cleanup_on_error() {
    log_error "Build failed. Cleaning up..."
    # Add cleanup logic here if needed
    exit 1
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --mock-mode)
            MOCK_MODE="true"
            shift
            ;;
        --production)
            MOCK_MODE="false"
            shift
            ;;
        --debug)
            DEBUG_MODE="true"
            shift
            ;;
        --memory)
            MEMORY_MB="$2"
            shift 2
            ;;
        --cpus)
            CPU_COUNT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --mock-mode       Build with MOCK_MPC=true for testing"
            echo "  --production      Build with production settings (default)"
            echo "  --debug           Enable enclave debug mode"
            echo "  --memory MB       Memory allocation (default: 1024)"
            echo "  --cpus COUNT      CPU count (default: 2)"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Example:"
            echo "  $0 --mock-mode           # Build for local testing"
            echo "  $0 --production          # Build for production"
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
# Main Build Process
# ============================================================================

trap cleanup_on_error ERR

log_info "Starting Nitro Enclave build process..."
echo ""

# Step 1: Check prerequisites
check_prerequisites
echo ""

# Step 2: Build Docker image
build_docker_image
echo ""

# Step 3: Convert to EIF
build_enclave_image
echo ""

# Step 4: Extract PCR measurements
extract_pcr_measurements
echo ""

# Step 5: Display summary
display_summary

log_info "Build completed successfully!"

exit 0
