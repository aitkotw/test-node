# AWS Nitro Enclave Deployment Guide

Complete guide for building and deploying the MPC Signing Service on AWS Nitro Enclaves.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Building the Enclave](#building-the-enclave)
- [Running the Enclave](#running-the-enclave)
- [vsock Forwarding](#vsock-forwarding)
- [Production Deployment](#production-deployment)
- [Monitoring & Debugging](#monitoring--debugging)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### EC2 Instance Requirements

1. **Instance Type**: Enclave-enabled instance
   - Recommended: `m5.xlarge`, `m5.2xlarge`, `c5.xlarge`, `c5.2xlarge`
   - See [full list of supported instances](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)

2. **AMI**: Amazon Linux 2 or Ubuntu 20.04+
   - Amazon Linux 2 recommended for best support

3. **Instance Configuration**:
   - Enable Nitro Enclaves in launch settings
   - Allocate resources for enclaves (CPU and memory)

### Software Prerequisites

```bash
# On Amazon Linux 2
sudo amazon-linux-extras install aws-nitro-enclaves-cli -y
sudo yum install aws-nitro-enclaves-cli-devel -y

# Install Docker
sudo yum install docker -y
sudo usermod -aG docker $USER
sudo systemctl enable docker
sudo systemctl start docker

# Install socat (for vsock forwarding)
sudo yum install socat -y

# Install jq (for JSON parsing)
sudo yum install jq -y

# On Ubuntu 20.04+
sudo apt update
sudo apt install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
sudo apt install -y docker.io socat jq
sudo usermod -aG docker $USER
sudo usermod -aG ne $USER
```

### Configure Nitro Enclaves

```bash
# Allocate resources to enclaves
# Edit /etc/nitro_enclaves/allocator.yaml
sudo vi /etc/nitro_enclaves/allocator.yaml
```

Example configuration (allocate 2 CPUs and 2GB memory to enclaves):

```yaml
# /etc/nitro_enclaves/allocator.yaml
memory_mib: 2048
cpu_count: 2
```

```bash
# Enable and start the allocator service
sudo systemctl enable nitro-enclaves-allocator.service
sudo systemctl start nitro-enclaves-allocator.service

# Verify service is running
sudo systemctl status nitro-enclaves-allocator.service
```

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo>
cd test-node/enclave

# 2. Build the enclave image
./build-eif.sh --production

# 3. Run the enclave
./run-enclave.sh

# 4. Verify it's running
curl http://localhost:5000/v1/health
```

## Building the Enclave

### Development Build (Mock Mode)

For local testing with mock MPC:

```bash
cd enclave
./build-eif.sh --mock-mode
```

This builds with:
- `MOCK_MPC=true` - Use mock MPC protocol
- `KEYSTORE_TYPE=memory` - Use in-memory storage
- Faster build time
- **NOT for production use**

### Production Build

For production deployment:

```bash
cd enclave
./build-eif.sh --production
```

This builds with:
- `MOCK_MPC=false` - Production MPC (requires GG20 implementation)
- `KEYSTORE_TYPE=file` - File-based sealed storage
- Optimized for security

### Build Options

```bash
./build-eif.sh [OPTIONS]

Options:
  --mock-mode       Build with MOCK_MPC=true for testing
  --production      Build with production settings (default)
  --debug           Enable enclave debug mode (allows console access)
  --memory MB       Memory allocation hint (default: 1024)
  --cpus COUNT      CPU count hint (default: 2)
  -h, --help        Show help message
```

### Build Output

After successful build, you'll have:

```
enclave/
├── enclave.eif           # Enclave Image File
├── enclave-pcr.json      # PCR measurements for attestation
└── ...
```

**Important**: Save the PCR measurements! Clients need these to verify attestation.

Example PCR output:
```json
{
  "Measurements": {
    "PCR0": "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "PCR1": "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "PCR2": "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

### Custom Dockerfile

To modify the Docker image:

1. Edit [Dockerfile](Dockerfile)
2. Rebuild: `./build-eif.sh --production`

## Running the Enclave

### Basic Usage

```bash
cd enclave
./run-enclave.sh
```

This will:
1. Stop any existing enclaves
2. Start the enclave with default settings (1GB memory, 2 CPUs)
3. Set up vsock forwarding on port 5000
4. Display enclave information

### Run Options

```bash
./run-enclave.sh [OPTIONS]

Options:
  --memory MB         Memory allocation in MB (default: 1024)
  --cpus COUNT        CPU count (default: 2)
  --debug             Enable debug mode (see console output)
  --vsock-port PORT   Parent vsock port (default: 5000)
  --enclave-cid CID   Enclave CID (default: 16)
  --no-vsock          Skip vsock proxy setup
  -h, --help          Show help
```

### Examples

**Run with more resources:**
```bash
./run-enclave.sh --memory 2048 --cpus 4
```

**Run in debug mode (see console output):**
```bash
./run-enclave.sh --debug
```

**Run without vsock proxy (manual setup):**
```bash
./run-enclave.sh --no-vsock
```

**Custom vsock port:**
```bash
./run-enclave.sh --vsock-port 6000
```

### Verify Enclave is Running

```bash
# Check enclave status
nitro-cli describe-enclaves

# Test HTTP endpoint
curl http://localhost:5000/v1/health

# Expected response:
# {"status":"healthy","timestamp":"2025-10-13T12:34:56.789Z","mockMode":false}
```

## vsock Forwarding

The enclave communicates with the parent instance via vsock (virtual socket). We use `socat` to forward TCP connections.

### Automatic Setup

The `run-enclave.sh` script automatically sets up vsock forwarding:

```bash
./run-enclave.sh  # Forwards localhost:5000 to enclave CID:16 port 5000
```

### Manual Setup

If you need to set up vsock forwarding manually:

```bash
# Forward localhost:5000 to enclave CID 16, port 5000
socat TCP-LISTEN:5000,reuseaddr,fork VSOCK-CONNECT:16:5000 &

# Save PID for cleanup
echo $! > /tmp/vsock-proxy.pid
```

### Stop vsock Forwarding

```bash
# If using run-enclave.sh
kill $(cat /tmp/vsock-proxy-5000.pid)

# Or find and kill socat process
pkill -f "socat.*VSOCK-CONNECT"
```

### Verify vsock Forwarding

```bash
# Check if socat is running
ps aux | grep socat

# Test connection
curl http://localhost:5000/v1/health

# Check logs
tail -f /tmp/vsock-proxy.log
```

## Production Deployment

### Step-by-Step Production Deployment

#### 1. Prepare EC2 Instance

```bash
# Launch enclave-enabled instance
# - m5.xlarge or larger
# - Amazon Linux 2
# - Security group: allow inbound 443 (HTTPS)
# - Enable Nitro Enclaves
```

#### 2. Configure Resources

```bash
# SSH into instance
ssh ec2-user@<instance-ip>

# Configure enclave allocator
sudo vi /etc/nitro_enclaves/allocator.yaml

# Allocate sufficient resources (example for m5.xlarge)
# cpu_count: 2     # Out of 4 total
# memory_mib: 4096 # Out of 16GB total

sudo systemctl restart nitro-enclaves-allocator.service
```

#### 3. Install Prerequisites

```bash
# Install all required packages
sudo amazon-linux-extras install aws-nitro-enclaves-cli -y
sudo yum install -y docker socat jq aws-nitro-enclaves-cli-devel
sudo usermod -aG docker ec2-user
sudo usermod -aG ne ec2-user

# Enable services
sudo systemctl enable docker nitro-enclaves-allocator
sudo systemctl start docker nitro-enclaves-allocator

# Log out and back in for group membership
exit
```

#### 4. Deploy Code

```bash
# Clone repository
git clone <your-repo>
cd test-node/enclave

# Or upload with scp
scp -r enclave/ ec2-user@<instance-ip>:~/
```

#### 5. Build Enclave Image

```bash
cd enclave

# IMPORTANT: Replace mock MPC with production implementation first!
# Edit mpc-protocol.ts and implement real GG20

# Build production image
./build-eif.sh --production

# Save PCR measurements
cat enclave-pcr.json
# Store these securely - clients will need them for attestation
```

#### 6. Run Enclave

```bash
# Start with production settings
./run-enclave.sh --memory 4096 --cpus 2

# Verify it's running
curl http://localhost:5000/v1/health
```

#### 7. Set Up Parent Proxy

```bash
cd ..  # Back to test-node/

# Install parent proxy dependencies
npm install

# Configure environment
cat > .env << EOF
PROXY_PORT=443
ENCLAVE_URL=http://127.0.0.1:5000
LOG_LEVEL=info
NODE_ENV=production
EOF

# Install SSL certificate (Let's Encrypt recommended)
# sudo certbot certonly --standalone -d your-domain.com

# Start parent proxy (use systemd for production)
npm run start:proxy
```

#### 8. Configure Systemd Services

**Enclave Service** (`/etc/systemd/system/nitro-enclave.service`):

```ini
[Unit]
Description=Nitro Enclave - MPC Signing Service
After=nitro-enclaves-allocator.service docker.service
Requires=nitro-enclaves-allocator.service docker.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/test-node/enclave
ExecStart=/home/ec2-user/test-node/enclave/run-enclave.sh --memory 4096 --cpus 2
ExecStop=/usr/bin/nitro-cli terminate-enclave --all
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

**Parent Proxy Service** (`/etc/systemd/system/mpc-proxy.service`):

```ini
[Unit]
Description=MPC Parent Proxy
After=network.target nitro-enclave.service
Requires=nitro-enclave.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/test-node
Environment="NODE_ENV=production"
Environment="PROXY_PORT=443"
Environment="ENCLAVE_URL=http://127.0.0.1:5000"
ExecStart=/usr/bin/node parent-proxy.js
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

Enable services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nitro-enclave mpc-proxy
sudo systemctl start nitro-enclave mpc-proxy
```

#### 9. Verify Production Deployment

```bash
# Check enclave status
nitro-cli describe-enclaves

# Check services
sudo systemctl status nitro-enclave
sudo systemctl status mpc-proxy

# Test from external client
curl https://your-domain.com/v1/health
```

### High Availability Setup

For production HA deployment:

1. **Multiple EC2 Instances**
   - Deploy 2+ instances in different AZs
   - Each runs enclave + parent proxy

2. **Application Load Balancer**
   - Target: Parent proxy instances (port 443)
   - Health check: `/health`
   - Stickiness: Not required

3. **Auto Scaling Group**
   - Min: 2, Max: 10 instances
   - Scale on CPU or request count

4. **Route 53**
   - Point domain to ALB

```
            ┌─────────────┐
            │  Route 53   │
            └──────┬──────┘
                   │
            ┌──────▼──────┐
            │     ALB     │
            └──────┬──────┘
                   │
        ┏━━━━━━━━━┻━━━━━━━━━┓
        ▼                    ▼
┌───────────────┐    ┌───────────────┐
│  EC2 (AZ-a)   │    │  EC2 (AZ-b)   │
│  - Enclave    │    │  - Enclave    │
│  - Proxy      │    │  - Proxy      │
└───────────────┘    └───────────────┘
```

## Monitoring & Debugging

### View Enclave Console

```bash
# Get enclave ID
ENCLAVE_ID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')

# Connect to console
nitro-cli console --enclave-id $ENCLAVE_ID

# Press Ctrl+C to exit console
```

### Check Logs

```bash
# vsock proxy logs
tail -f /tmp/vsock-proxy.log

# Parent proxy logs (if running with npm)
# Logs go to stdout

# Enclave logs (view via console)
nitro-cli console --enclave-id <enclave-id>
```

### Enclave Metrics

```bash
# Describe running enclaves
nitro-cli describe-enclaves | jq

# Check resource usage
nitro-cli describe-enclaves | jq '.[0] | {
  State: .State,
  Memory: .MemoryMiB,
  CPUs: .CPUCount,
  CID: .EnclaveCID
}'
```

### Health Checks

```bash
# Enclave health
curl http://localhost:5000/v1/health

# Parent proxy health (from external)
curl https://your-domain.com/health
```

## Troubleshooting

### Enclave won't start

**Error**: `Insufficient memory`

```bash
# Check available resources
nitro-cli describe-enclaves

# Increase allocation in /etc/nitro_enclaves/allocator.yaml
sudo vi /etc/nitro_enclaves/allocator.yaml
sudo systemctl restart nitro-enclaves-allocator.service
```

**Error**: `Insufficient CPUs`

```bash
# Reduce CPU count or allocate more
./run-enclave.sh --cpus 1  # Try with fewer CPUs
```

**Error**: `File not found: enclave.eif`

```bash
# Build the EIF first
./build-eif.sh --production
```

### vsock connection fails

**Error**: `Connection refused on localhost:5000`

```bash
# Check if socat is running
ps aux | grep socat

# Check if enclave is running
nitro-cli describe-enclaves

# Restart vsock proxy
pkill -f socat
socat TCP-LISTEN:5000,reuseaddr,fork VSOCK-CONNECT:16:5000 &

# Test again
curl http://localhost:5000/v1/health
```

### Enclave crashes

```bash
# View console for errors
nitro-cli console --enclave-id <enclave-id>

# Check Docker build logs
docker logs <container-id>

# Rebuild with debug mode
./build-eif.sh --production --debug
./run-enclave.sh --debug
```

### Port already in use

```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill <pid>

# Or use a different port
./run-enclave.sh --vsock-port 6000
```

### Cannot build Docker image

```bash
# Check Docker daemon
sudo systemctl status docker
sudo systemctl start docker

# Check permissions
sudo usermod -aG docker $USER
# Log out and back in

# Clean Docker cache
docker system prune -af
```

## Security Checklist

Before production deployment:

- [ ] Replace mock MPC with vetted GG20 implementation
- [ ] Implement AWS KMS sealed storage
- [ ] Set up HTTPS with valid certificate
- [ ] Configure security groups (minimal access)
- [ ] Enable CloudWatch logging
- [ ] Set up monitoring and alerts
- [ ] Document PCR measurements
- [ ] Implement attestation verification
- [ ] Review all environment variables
- [ ] Enable AWS CloudTrail
- [ ] Set up backup procedures
- [ ] Test disaster recovery
- [ ] Security audit completed
- [ ] Penetration testing completed

## Additional Resources

- [AWS Nitro Enclaves Documentation](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)
- [Nitro CLI Reference](https://github.com/aws/aws-nitro-enclaves-cli)
- [GG20 Paper](https://eprint.iacr.org/2020/540.pdf)
- [Project README](../README.md)
- [Architecture Documentation](../ARCHITECTURE.md)

## Support

For issues or questions:
- Check [Troubleshooting](#troubleshooting)
- Review [README.md](../README.md)
- Open an issue on GitHub
