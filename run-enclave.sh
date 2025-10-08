#!/bin/bash

# Script to run the AWS Nitro Enclave
# This script starts the enclave with the specified configuration

set -e

echo "========================================="
echo "Starting AWS Nitro Enclave"
echo "========================================="

# Configuration
EIF_FILE="enclave-service.eif"
ENCLAVE_CONFIG="enclave-config.yaml"
MEMORY_MB=2048
CPU_COUNT=2
DEBUG_MODE="true"

# Check if EIF exists
if [ ! -f "${EIF_FILE}" ]; then
    echo "Error: EIF file not found: ${EIF_FILE}"
    echo "Please run ./build-eif.sh first"
    exit 1
fi

# Check if an enclave is already running
RUNNING_ENCLAVES=$(nitro-cli describe-enclaves | jq -r '.[].EnclaveID' 2>/dev/null || echo "")

if [ ! -z "$RUNNING_ENCLAVES" ]; then
    echo "Warning: Enclave(s) already running"
    echo "Enclave IDs: $RUNNING_ENCLAVES"
    echo ""
    read -p "Do you want to terminate existing enclaves and start fresh? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for ENCLAVE_ID in $RUNNING_ENCLAVES; do
            echo "Terminating enclave: $ENCLAVE_ID"
            nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID
        done
    else
        echo "Exiting. Please terminate existing enclaves manually with:"
        echo "  nitro-cli terminate-enclave --enclave-id <ENCLAVE_ID>"
        exit 1
    fi
fi

# Start the enclave
echo ""
echo "Starting enclave with:"
echo "  EIF: ${EIF_FILE}"
echo "  Memory: ${MEMORY_MB} MB"
echo "  CPUs: ${CPU_COUNT}"
echo "  Debug mode: ${DEBUG_MODE}"
echo ""

if [ "${DEBUG_MODE}" = "true" ]; then
    nitro-cli run-enclave \
        --eif-path ${EIF_FILE} \
        --memory ${MEMORY_MB} \
        --cpu-count ${CPU_COUNT} \
        --debug-mode
else
    nitro-cli run-enclave \
        --eif-path ${EIF_FILE} \
        --memory ${MEMORY_MB} \
        --cpu-count ${CPU_COUNT}
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Enclave started successfully!"
    echo ""
    echo "To view enclave status:"
    echo "  nitro-cli describe-enclaves"
    echo ""
    echo "To view enclave console (debug mode only):"
    echo "  nitro-cli console --enclave-id <ENCLAVE_ID>"
    echo ""
    echo "To test communication:"
    echo "  node parent-client.js"
    echo ""
else
    echo "✗ Failed to start enclave"
    exit 1
fi
