#!/bin/bash

echo "🔍 Quick Debug - Checking Enclave Status"

# Check running enclaves
echo "=== Running Enclaves ==="
nitro-cli describe-enclaves

# Check vsock proxy
echo -e "\n=== Vsock Proxy Status ==="
ps aux | grep vsock-proxy | grep -v grep

# Check port binding
echo -e "\n=== Port Binding ==="
netstat -tulpn 2>/dev/null | grep ":3000" || echo "Port 3000 not bound"

# Get enclave ID for logs
ENCLAVE_ID=$(cat ./enclave-runtime.json 2>/dev/null | jq -r '.enclave_id' 2>/dev/null || echo "")
if [ ! -z "$ENCLAVE_ID" ] && [ "$ENCLAVE_ID" != "null" ]; then
    echo -e "\n=== Recent Enclave Logs ==="
    timeout 3 nitro-cli console --enclave-id $ENCLAVE_ID 2>/dev/null || echo "Could not retrieve logs"
fi