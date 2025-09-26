#!/bin/bash

# Build EIF file for AWS Nitro Enclave
set -e

echo "Building Docker image for enclave..."
docker-compose build enclave-app

echo "Building EIF file using nitro-cli..."
docker-compose --profile build up eif-builder

echo "EIF file built successfully: enclave-service.eif"
echo "You can now use this EIF file with AWS Nitro Enclaves"

# Display EIF info
if [ -f "enclave-service.eif" ]; then
    echo "EIF file details:"
    ls -lh enclave-service.eif
fi