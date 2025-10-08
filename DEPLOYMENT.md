# AWS Nitro Enclave Deployment Guide

This guide walks you through deploying the enclave service on an AWS EC2 instance with Nitro Enclave support.

## Prerequisites

### 1. EC2 Instance Requirements
- **Instance Type**: Must support Nitro Enclaves (e.g., `m5.xlarge`, `c5.xlarge`, `r5.xlarge`, etc.)
- **AMI**: Amazon Linux 2 or Amazon Linux 2023
- **vCPUs**: At least 4 vCPUs (2 for host, 2 for enclave)
- **Memory**: At least 4 GB (allocate 512 MB to enclave)

### 2. Software Requirements
- Docker
- Nitro CLI
- Node.js (for parent instance client)
- git

## Step 1: Launch EC2 Instance

### Using AWS Console:
1. Go to EC2 Dashboard
2. Launch Instance
3. Choose **Amazon Linux 2023** AMI
4. Select instance type: **m5.xlarge** (or larger)
5. In **Advanced Details**, enable **Nitro Enclaves**
6. Configure security group (HTTP/HTTPS if needed)
7. Launch instance

### Using AWS CLI:
```bash
aws ec2 run-instances \
    --image-id ami-xxxxxxxxx \
    --instance-type m5.xlarge \
    --enclave-options 'Enabled=true' \
    --key-name your-key-pair \
    --security-group-ids sg-xxxxxxxxx \
    --subnet-id subnet-xxxxxxxxx
```

## Step 2: Install Dependencies

SSH into your EC2 instance and run:

```bash
# Update system
sudo yum update -y

# Install Docker
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install Nitro CLI
sudo amazon-linux-extras install aws-nitro-enclaves-cli -y
sudo yum install aws-nitro-enclaves-cli-devel -y

# Configure Nitro Enclaves allocator
# Allocate 2 CPUs and 512 MB memory for enclaves
sudo sed -i 's/^cpu_count:.*/cpu_count: 2/' /etc/nitro_enclaves/allocator.yaml
sudo sed -i 's/^memory_mib:.*/memory_mib: 512/' /etc/nitro_enclaves/allocator.yaml

# Enable and start Nitro Enclaves allocator
sudo systemctl enable nitro-enclaves-allocator.service
sudo systemctl start nitro-enclaves-allocator.service

# Install Node.js (for parent client)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install git
sudo yum install -y git

# Log out and back in for docker group changes to take effect
exit
```

SSH back in after logging out.

## Step 3: Clone and Setup Project

```bash
# Clone your repository
git clone https://github.com/your-username/test-node.git
cd test-node

# Install dependencies for parent client
npm install
```

## Step 4: Build Enclave Image

```bash
# Build Docker image and create EIF (Enclave Image File)
./build-eif.sh
```

This will:
- Build the Docker image with your Node.js application
- Convert it to an Enclave Image File (EIF)
- Display PCR measurements for attestation

**Important**: Save the PCR values displayed during build - you'll need them for attestation!

## Step 5: Run the Enclave

```bash
# Start the enclave
./run-enclave.sh
```

This will:
- Check for existing enclaves
- Start a new enclave with configured resources
- Display the Enclave ID and CID

### Verify Enclave is Running:
```bash
nitro-cli describe-enclaves
```

Output should show:
```json
[
  {
    "EnclaveID": "i-xxxxx-enc-xxxxx",
    "EnclaveCID": 16,
    "NumberOfCPUs": 2,
    "CPUIDs": [1, 3],
    "MemoryMiB": 512,
    "State": "RUNNING",
    "Flags": "DEBUG_MODE"
  }
]
```

## Step 6: Test Communication

Test the vsock communication between parent instance and enclave:

```bash
# Run the test client
node parent-client.js
```

Expected output:
```
========================================
AWS Nitro Enclave Communication Test
========================================

Found running enclave with CID: 16

[Test 1] Health Check
-------------------
Connected to enclave (CID: 16, Port: 5000)
Sending request: {"type":"health"}
Response: {
  "success": true,
  "data": {
    "status": "healthy",
    "enclave": true
  },
  "timestamp": "2025-10-08T..."
}
✓ Health check passed

[Test 2] Status Check
-------------------
...
```

## Step 7: View Enclave Console (Debug Mode)

To see the enclave's console output:

```bash
# Get enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Connect to console
nitro-cli console --enclave-id $ENCLAVE_ID
```

Press `Ctrl+C` to exit console view.

## Management Commands

### Stop Enclave:
```bash
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID
```

### Restart Enclave:
```bash
./run-enclave.sh
```

### Rebuild After Code Changes:
```bash
./build-eif.sh
./run-enclave.sh
```

### View Logs:
```bash
# Enclave console (debug mode only)
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Parent instance logs
journalctl -u nitro-enclaves-allocator -f
```

## Troubleshooting

### Issue: "No such file or directory" when starting enclave
**Solution**: Make sure Docker service is running and you're in the docker group:
```bash
sudo systemctl start docker
sudo usermod -aG docker $USER
# Log out and back in
```

### Issue: "Not enough CPUs/memory available"
**Solution**: Adjust allocator configuration:
```bash
sudo nano /etc/nitro_enclaves/allocator.yaml
# Modify cpu_count and memory_mib
sudo systemctl restart nitro-enclaves-allocator.service
```

### Issue: "Cannot connect to enclave"
**Solution**: Check enclave is running and get correct CID:
```bash
nitro-cli describe-enclaves
```

### Issue: "Failed to retrieve enclave CID"
**Solution**: This means no enclave is running. Start it with:
```bash
./run-enclave.sh
```

## Production Considerations

### 1. Disable Debug Mode
In production, disable debug mode for security:
- Edit `run-enclave.sh` and set `DEBUG_MODE="false"`
- Rebuild and restart enclave

### 2. Attestation
Use the PCR values from the build to verify enclave authenticity:
```bash
# During build, save these values:
# PCR0: <hash>
# PCR1: <hash>
# PCR2: <hash>
```

### 3. Monitoring
Set up CloudWatch for enclave metrics:
```bash
aws cloudwatch put-metric-data --namespace "NitroEnclaves" \
    --metric-name "EnclaveRunning" --value 1
```

### 4. Auto-restart
Create a systemd service to auto-start enclave on boot:
```bash
sudo nano /etc/systemd/system/nitro-enclave.service
```

### 5. Security
- Use IAM roles for EC2 instance
- Restrict network access via security groups
- Implement proper key management
- Enable AWS KMS integration for encryption

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         AWS EC2 Instance (Parent)       │
│  ┌───────────────────────────────────┐  │
│  │     Parent Instance (CID 3)       │  │
│  │                                   │  │
│  │  • parent-client.js               │  │
│  │  • node-vsock client              │  │
│  │  • Sends requests via vsock       │  │
│  └───────────────┬───────────────────┘  │
│                  │ vsock                 │
│                  │ port 5000             │
│  ┌───────────────▼───────────────────┐  │
│  │   Nitro Enclave (CID: dynamic)    │  │
│  │                                   │  │
│  │  • Node.js Application            │  │
│  │  • Express HTTP Server (3000)     │  │
│  │  • Vsock Server (5000)            │  │
│  │  • Isolated secure environment    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Environment Variables

- `PORT`: HTTP server port (default: 3000) - for internal use
- `VSOCK_PORT`: Vsock server port (default: 5000)
- `NODE_ENV`: Environment mode (production/development)

## Next Steps

1. Integrate with your application logic
2. Implement proper authentication
3. Add KMS integration for key management
4. Set up attestation verification
5. Configure monitoring and alerts
6. Create backup and recovery procedures

## Resources

- [AWS Nitro Enclaves Documentation](https://docs.aws.amazon.com/enclaves/)
- [Nitro CLI Reference](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli.html)
- [node-vsock Package](https://www.npmjs.com/package/node-vsock)
