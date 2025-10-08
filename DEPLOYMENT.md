# AWS Nitro Enclave Deployment Guide

Complete guide for deploying this Node.js application inside an AWS Nitro Enclave with vsock communication.

## Table of Contents
- [Prerequisites](#prerequisites)
- [EC2 Instance Setup](#ec2-instance-setup)
- [Installation](#installation)
- [Building the Enclave](#building-the-enclave)
- [Running the Enclave](#running-the-enclave)
- [Testing Communication](#testing-communication)
- [Management](#management)
- [Troubleshooting](#troubleshooting)
- [Production Deployment](#production-deployment)

---

## Prerequisites

### Required AWS Resources

**EC2 Instance Type:**
- Must support AWS Nitro Enclaves
- Recommended: `m5.xlarge`, `m5.2xlarge`, `c5.xlarge`, `c5.2xlarge`, `r5.xlarge`
- Minimum: 4 vCPUs (2 for parent, 2 for enclave)
- Minimum: 4 GB RAM

**Operating System:**
- Amazon Linux 2023 (recommended)
- Amazon Linux 2
- Ubuntu 20.04+ (with Nitro CLI support)

**Software Requirements:**
- Docker
- AWS Nitro Enclaves CLI
- Node.js 20.x (for parent instance client)
- Git

---

## EC2 Instance Setup

### Option 1: AWS Console

1. Navigate to **EC2 Dashboard** → **Launch Instance**

2. **Configure Instance:**
   - **Name:** `nitro-enclave-server`
   - **AMI:** Amazon Linux 2023
   - **Instance Type:** `m5.xlarge` or larger

3. **Advanced Details:**
   - Scroll to **Nitro Enclaves**
   - Check **Enable** ✓

4. **Security Group:**
   - Allow SSH (port 22) from your IP
   - Optional: Allow HTTP/HTTPS if needed

5. **Key Pair:** Select or create key pair

6. **Launch Instance**

### Option 2: AWS CLI

```bash
# Create instance with Nitro Enclaves enabled
aws ec2 run-instances \
    --image-id ami-0c02fb55b34c50c98 \
    --instance-type m5.xlarge \
    --enclave-options 'Enabled=true' \
    --key-name your-key-pair \
    --security-group-ids sg-xxxxxxxxx \
    --subnet-id subnet-xxxxxxxxx \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=nitro-enclave-server}]'
```

### Option 3: CloudFormation Template

```yaml
Resources:
  EnclaveInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-0c02fb55b34c50c98  # Amazon Linux 2023
      InstanceType: m5.xlarge
      EnclaveOptions:
        Enabled: true
      KeyName: !Ref KeyPairName
      SecurityGroupIds:
        - !Ref SecurityGroup
      Tags:
        - Key: Name
          Value: nitro-enclave-server
```

---

## Installation

### Step 1: Connect to EC2 Instance

```bash
# SSH into your instance
ssh -i your-key.pem ec2-user@<EC2_PUBLIC_IP>
```

### Step 2: Install Docker

```bash
# Update system
sudo dnf update -y

# Install Docker
sudo dnf install -y docker

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to docker group
sudo usermod -aG docker $USER

# Verify Docker installation
docker --version
```

### Step 3: Install Nitro Enclaves CLI

```bash
# Install Nitro Enclaves CLI
sudo dnf install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel

# Verify installation
nitro-cli --version
```

### Step 4: Configure Nitro Enclaves Allocator

The allocator reserves CPU and memory for enclaves.

```bash
# Edit allocator configuration
sudo nano /etc/nitro_enclaves/allocator.yaml
```

**Set the following values:**
```yaml
# Enclave allocator configuration
memory_mib: 1024    # Allocate 1 GB for enclaves (adjust as needed)
cpu_count: 2        # Allocate 2 vCPUs for enclaves
```

**Apply configuration:**
```bash
# Enable and start allocator service
sudo systemctl enable nitro-enclaves-allocator.service
sudo systemctl start nitro-enclaves-allocator.service

# Verify allocator status
sudo systemctl status nitro-enclaves-allocator.service
```

### Step 5: Install Node.js

```bash
# Install Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load nvm
source ~/.bashrc

# Install Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# Verify installation
node --version
npm --version
```

### Step 6: Install Git and Clone Repository

```bash
# Install Git
sudo dnf install -y git

# Clone your repository
git clone https://github.com/your-username/test-node.git
cd test-node

# Install node-vsock for parent client
npm install
```

### Step 7: Log Out and Back In

```bash
# Exit to apply docker group membership
exit
```

**Reconnect via SSH to continue.**

---

## Building the Enclave

### Build Process Overview

The build process:
1. Compiles TypeScript to JavaScript
2. Creates Docker image with Node.js app
3. Converts Docker image to Enclave Image File (EIF)
4. Generates PCR measurements for attestation

### Execute Build Script

```bash
cd test-node

# Make build script executable (if not already)
chmod +x build-eif.sh

# Run build
./build-eif.sh
```

### Expected Output

```
=========================================
Building AWS Nitro Enclave Image
=========================================

[1/3] Building Docker image...
✓ Docker image built successfully: enclave-service:latest

[2/3] Converting Docker image to Enclave Image File (EIF)...
Start building the Enclave Image...
Enclave Image successfully created.
{
  "Measurements": {
    "HashAlgorithm": "Sha384 { ... }",
    "PCR0": "a1b2c3d4...",
    "PCR1": "e5f6g7h8...",
    "PCR2": "i9j0k1l2..."
  }
}
✓ EIF created successfully: enclave-service.eif

[3/3] EIF Measurements (PCRs):
These values are used for attestation and should be recorded securely

EIF file size: 112M

=========================================
Build Complete!
=========================================
```

**⚠️ IMPORTANT:** Save the PCR values for attestation verification!

### Manual Build (Alternative)

If you prefer manual steps:

```bash
# Build Docker image
docker build -t enclave-service:latest .

# Convert to EIF
nitro-cli build-enclave \
    --docker-uri enclave-service:latest \
    --output-file enclave-service.eif

# Verify EIF was created
ls -lh enclave-service.eif
```

---

## Running the Enclave

### Start the Enclave

```bash
# Make run script executable (if not already)
chmod +x run-enclave.sh

# Start enclave
./run-enclave.sh
```

### Expected Output

```
=========================================
Starting AWS Nitro Enclave
=========================================

Starting enclave with:
  EIF: enclave-service.eif
  Memory: 512 MB
  CPUs: 2
  Debug mode: true

Start allocating memory...
Started enclave with enclave-id: i-abc123-enc-def456, cpu-ids: [1, 3], memory: 512 MiB

✓ Enclave started successfully!

To view enclave status:
  nitro-cli describe-enclaves

To view enclave console (debug mode only):
  nitro-cli console --enclave-id <ENCLAVE_ID>

To test communication:
  node parent-client.js
```

### Verify Enclave is Running

```bash
# Check enclave status
nitro-cli describe-enclaves
```

**Expected output:**
```json
[
  {
    "EnclaveID": "i-abc123-enc-def456",
    "ProcessID": 12345,
    "EnclaveCID": 16,
    "NumberOfCPUs": 2,
    "CPUIDs": [1, 3],
    "MemoryMiB": 512,
    "State": "RUNNING",
    "Flags": "DEBUG_MODE"
  }
]
```

**Key Information:**
- **EnclaveCID:** The Context ID for vsock communication (e.g., 16)
- **State:** Should be `RUNNING`

### View Enclave Console Logs

In debug mode, you can view the enclave's console output:

```bash
# Get enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Connect to console
nitro-cli console --enclave-id $ENCLAVE_ID
```

You should see:
```
[HTTP Server] Running on port 3000
[Vsock Server] Listening on port 5000
[Vsock Server] Ready for connections from parent instance (CID 3)
[Enclave] Vsock server started successfully
```

**Press Ctrl+C to exit console view.**

### Manual Start (Alternative)

```bash
# Start enclave manually
nitro-cli run-enclave \
    --eif-path enclave-service.eif \
    --memory 512 \
    --cpu-count 2 \
    --debug-mode
```

---

## Testing Communication

### Run Test Client

The parent client tests vsock communication with the enclave:

```bash
# Make client executable (if not already)
chmod +x parent-client.js

# Run tests
node parent-client.js
```

### Expected Output

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
  "timestamp": "2025-10-08T15:30:45.123Z"
}
✓ Health check passed

[Test 2] Status Check
-------------------
Connected to enclave (CID: 16, Port: 5000)
Sending request: {"type":"status"}
Response: {
  "success": true,
  "data": {
    "enclave": "initialized",
    "secure": true,
    "ready": true,
    "vsock": "connected"
  },
  "timestamp": "2025-10-08T15:30:45.456Z"
}
✓ Status check passed

[Test 3] Compute Request
-------------------
Connected to enclave (CID: 16, Port: 5000)
Sending request: {"type":"compute","data":{"operation":"encrypt","payload":"sensitive data"}}
Response: {
  "success": true,
  "data": {
    "result": "computation completed",
    "inputReceived": true,
    "processedData": {
      "operation": "encrypt",
      "payload": "sensitive data"
    }
  },
  "timestamp": "2025-10-08T15:30:45.789Z"
}
✓ Compute request passed

========================================
All tests completed!
========================================
```

### Custom Test Script

Create your own client:

```javascript
const { VsockSocket } = require('node-vsock');
const { execSync } = require('child_process');

// Get enclave CID
const enclaves = JSON.parse(execSync('nitro-cli describe-enclaves').toString());
const enclaveCID = enclaves[0].EnclaveCID;

// Create client
const client = new VsockSocket();

client.connect(enclaveCID, 5000, () => {
  // Send request
  const request = { type: 'status' };
  client.writeTextSync(JSON.stringify(request));

  // Receive response
  client.on('data', (buf) => {
    console.log('Response:', buf.toString());
    client.end();
  });
});
```

---

## Management

### View Enclave Status

```bash
# List all running enclaves
nitro-cli describe-enclaves

# Pretty print JSON
nitro-cli describe-enclaves | jq '.'
```

### View Enclave Console

```bash
# Get enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# View console logs
nitro-cli console --enclave-id $ENCLAVE_ID
```

### Stop Enclave

```bash
# Get enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Terminate enclave
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID
```

### Restart Enclave

```bash
# Stop existing enclave
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID

# Start new enclave
./run-enclave.sh
```

### Update Application

After code changes:

```bash
# Rebuild EIF
./build-eif.sh

# Stop old enclave
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli terminate-enclave --enclave-id $ENCLAVE_ID

# Start new enclave
./run-enclave.sh

# Test
node parent-client.js
```

---

## Troubleshooting

### Issue: "No such file or directory" when starting enclave

**Cause:** Docker service not running or not in docker group.

**Solution:**
```bash
# Check Docker status
sudo systemctl status docker

# Start Docker if stopped
sudo systemctl start docker

# Verify user is in docker group
groups

# If not in docker group
sudo usermod -aG docker $USER
exit  # Log out and back in
```

### Issue: "Insufficient memory" or "Insufficient CPUs"

**Cause:** Not enough resources allocated to enclave allocator.

**Solution:**
```bash
# Check current allocation
cat /etc/nitro_enclaves/allocator.yaml

# Edit allocation
sudo nano /etc/nitro_enclaves/allocator.yaml
# Increase memory_mib and/or cpu_count

# Restart allocator
sudo systemctl restart nitro-enclaves-allocator.service

# Verify
sudo systemctl status nitro-enclaves-allocator.service
```

### Issue: "Cannot connect to enclave"

**Cause:** Enclave not running or wrong CID.

**Solution:**
```bash
# Check if enclave is running
nitro-cli describe-enclaves

# If no enclaves, start one
./run-enclave.sh

# Get correct CID
nitro-cli describe-enclaves | jq -r '.[0].EnclaveCID'
```

### Issue: "vsock connection timeout"

**Cause:** Enclave app not listening on vsock port.

**Solution:**
```bash
# Check enclave console for errors
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')
nitro-cli console --enclave-id $ENCLAVE_ID

# Look for vsock server startup messages
# Should see: "[Vsock Server] Listening on port 5000"
```

### Issue: Build fails with "npm ERR!"

**Cause:** Missing dependencies or network issues.

**Solution:**
```bash
# Check Docker networking
docker run --rm alpine ping -c 3 google.com

# Rebuild with no cache
docker build --no-cache -t enclave-service:latest .
```

### Issue: "Failed to retrieve enclave CID" from Enclave Console

**Cause:** Trying to connect to console from outside EC2 instance.

**Solution:** The Enclave Console application mentioned in your original error runs on the **parent EC2 instance**, not locally. Ensure you're:
1. SSH'd into the EC2 instance
2. Have an enclave running
3. Using `nitro-cli console` command

---

## Production Deployment

### 1. Disable Debug Mode

For production, disable debug mode to prevent console access:

```bash
# Edit run-enclave.sh
nano run-enclave.sh

# Change this line:
DEBUG_MODE="false"

# Rebuild and restart
./build-eif.sh
./run-enclave.sh
```

### 2. Record PCR Measurements

Save PCR values from build output for attestation:

```bash
# During build, save PCRs
./build-eif.sh | tee build-output.txt

# Extract PCRs
grep -A 5 "Measurements" build-output.txt > pcr-measurements.json
```

### 3. Implement Attestation

Add attestation verification in your parent application:

```javascript
// Verify enclave attestation
const expectedPCRs = {
  PCR0: "a1b2c3d4...",
  PCR1: "e5f6g7h8...",
  PCR2: "i9j0k1l2..."
};

// Request attestation document from enclave
// Verify PCRs match expected values
```

### 4. Set Up Monitoring

Create CloudWatch alarms:

```bash
# Monitor enclave status
aws cloudwatch put-metric-alarm \
    --alarm-name enclave-not-running \
    --alarm-description "Alert if enclave stops" \
    --metric-name EnclaveState \
    --namespace NitroEnclaves \
    --statistic Sum \
    --period 300 \
    --threshold 1 \
    --comparison-operator LessThanThreshold
```

### 5. Auto-Start on Boot

Create systemd service:

```bash
sudo nano /etc/systemd/system/nitro-enclave.service
```

```ini
[Unit]
Description=Nitro Enclave Application
After=docker.service nitro-enclaves-allocator.service
Requires=docker.service nitro-enclaves-allocator.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/test-node
ExecStart=/home/ec2-user/test-node/run-enclave.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable service
sudo systemctl enable nitro-enclave.service
sudo systemctl start nitro-enclave.service
```

### 6. Implement KMS Integration

Use AWS KMS for key management:

```javascript
// Example: Decrypt data using KMS in enclave
const AWS = require('aws-sdk');
const kms = new AWS.KMS({ region: 'us-east-1' });

async function decryptWithKMS(ciphertext) {
  const params = {
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    EncryptionContext: { 'EnclaveID': process.env.ENCLAVE_ID }
  };

  const result = await kms.decrypt(params).promise();
  return result.Plaintext.toString();
}
```

### 7. Secure Network Access

Update security groups:

```bash
# Only allow SSH from bastion host
aws ec2 authorize-security-group-ingress \
    --group-id sg-xxxxxxxxx \
    --protocol tcp \
    --port 22 \
    --source-group sg-bastion
```

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────┐
│              AWS EC2 Instance (m5.xlarge)              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │         Parent Instance (CID 3)                  │ │
│  │                                                  │ │
│  │  • parent-client.js                              │ │
│  │  • Your application logic                        │ │
│  │  • AWS SDK / KMS integration                     │ │
│  │  • Sends requests via vsock                      │ │
│  └────────────────────┬─────────────────────────────┘ │
│                       │                                │
│                   vsock socket                         │
│               (CID 3 → CID 16, Port 5000)             │
│                       │                                │
│  ┌────────────────────▼─────────────────────────────┐ │
│  │       Nitro Enclave (CID 16 - dynamic)           │ │
│  │                                                  │ │
│  │  ┌────────────────────────────────────────────┐ │ │
│  │  │      Node.js Application                   │ │ │
│  │  │                                            │ │ │
│  │  │  • Express HTTP (port 3000) - internal    │ │ │
│  │  │  • Vsock Server (port 5000)               │ │ │
│  │  │  • Secure computations                    │ │ │
│  │  │  • Cryptographic operations               │ │ │
│  │  │  • Isolated from network                  │ │ │
│  │  └────────────────────────────────────────────┘ │ │
│  │                                                  │ │
│  │  Features:                                       │ │
│  │  ✓ Memory isolation                              │ │
│  │  ✓ No persistent storage                         │ │
│  │  ✓ No network access                             │ │
│  │  ✓ Cryptographic attestation                     │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

---

## Quick Reference Commands

```bash
# Build
./build-eif.sh

# Run
./run-enclave.sh

# Test
node parent-client.js

# Status
nitro-cli describe-enclaves

# Console
nitro-cli console --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Stop
nitro-cli terminate-enclave --enclave-id $(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Logs
journalctl -u nitro-enclaves-allocator -f
```

---

## Additional Resources

- [AWS Nitro Enclaves Documentation](https://docs.aws.amazon.com/enclaves/)
- [Nitro CLI Command Reference](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli.html)
- [node-vsock Package](https://www.npmjs.com/package/node-vsock)
- [AWS Nitro Enclaves Samples](https://github.com/aws/aws-nitro-enclaves-samples)
- [Attestation Process](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html)

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review AWS Nitro Enclaves documentation
3. Check application logs via console
4. Open GitHub issue with logs and error messages
