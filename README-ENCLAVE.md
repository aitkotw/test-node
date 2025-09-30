# AWS Nitro Enclave Service

This is a Node.js/Express application designed to run inside AWS Nitro Enclaves for secure, isolated compute workloads.

## 🚀 Quick Start

### Prerequisites

1. **EC2 Instance**: Must support Nitro Enclaves (M5, M5d, M5n, M5dn, M5zn, C5, C5d, C5n, R5, R5d, R5n, R5dn, or later generations)
2. **Amazon Linux 2**: Recommended OS
3. **Nitro CLI**: Install with `sudo amazon-linux-extras install aws-nitro-enclaves-cli`
4. **Docker**: Must be running
5. **Allocator Service**: Must be configured and running

### Installation

```bash
# Clone and setup
npm install

# Build the enclave
npm run enclave:build

# Start the enclave
npm run enclave:start

# Test connectivity
npm run enclave:test
```

## 📋 Available Commands

### Enclave Management
- `npm run enclave:build` - Build Docker image and convert to EIF
- `npm run enclave:start` - Start the enclave with vsock proxy
- `npm run enclave:stop` - Stop the enclave and cleanup
- `npm run enclave:test` - Test all endpoints
- `npm run enclave:logs` - View live enclave logs
- `npm run enclave:debug` - Comprehensive debug information

### Development
- `npm start` - Run locally with nodemon
- `npm run build` - Compile TypeScript
- `npm run docker:build` - Build Docker image only
- `npm run docker:run` - Run Docker container locally
- `npm run clean` - Remove all build artifacts

## 🔧 Configuration

### Enclave Configuration (`enclave-config.json`)
```json
{
  "cpu_count": 2,        // Number of CPUs for enclave
  "memory_mib": 512,     // Memory in MiB
  "vsock": {
    "port": 3000,        // Internal port
    "cid": 16           // Context ID for vsock
  }
}
```

### Environment Variables
- `PORT`: Application port (default: 3000)
- `NODE_ENV`: Environment (production/development)

## 🌐 API Endpoints

### Health Check
```bash
GET /health
```
Returns service health status.

### Root
```bash
GET /
```
Returns service information.

### Enclave Status
```bash
GET /api/enclave/status
```
Returns enclave-specific status.

### Compute
```bash
POST /api/enclave/compute
Content-Type: application/json

{
  "data": "your input data"
}
```
Performs secure computation inside the enclave.

## 🔍 Debugging

### Common Issues

#### 1. "Empty reply from server"
**Cause**: Server not binding to correct interface or vsock proxy issues.

**Solutions**:
```bash
# Check enclave status
npm run enclave:debug

# View logs
npm run enclave:logs

# Restart enclave
npm run enclave:stop && npm run enclave:start
```

#### 2. "Cannot allocate memory"
**Cause**: Insufficient memory allocated to enclaves.

**Solutions**:
```bash
# Check current allocation
cat /sys/module/nitro_enclaves/parameters/ne_mem_regions

# Reduce memory in enclave-config.json
# Or allocate more memory to enclaves during EC2 setup
```

#### 3. "Permission denied"
**Cause**: Insufficient permissions or services not running.

**Solutions**:
```bash
# Start required services
sudo systemctl start nitro-enclaves-allocator
sudo systemctl start docker

# Run with sudo if needed
sudo npm run enclave:start
```

### Debug Commands

```bash
# Full system check
npm run enclave:debug

# Check running enclaves
nitro-cli describe-enclaves

# View enclave console
nitro-cli console --enclave-id <ENCLAVE_ID>

# Check vsock proxy
ps aux | grep vsock-proxy

# Test local Docker container
npm run docker:run
```

## 🏗️ Architecture

### Application Flow
1. **Build**: TypeScript compiled to JavaScript, Docker image created, converted to EIF
2. **Start**: Enclave launched with specified resources, vsock proxy established
3. **Communication**: External requests → vsock proxy → enclave application
4. **Response**: Enclave application → vsock proxy → external client

### Files Structure
```
├── index.ts                 # Main application
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── Dockerfile              # Multi-stage Docker build
├── enclave-config.json     # Enclave settings
├── scripts/
│   ├── build-enclave.sh    # Build EIF from Docker
│   ├── start-enclave.sh    # Start enclave and proxy
│   ├── stop-enclave.sh     # Stop enclave and cleanup
│   ├── test-connection.sh  # Test all endpoints
│   ├── view-logs.sh        # View enclave logs
│   └── debug-enclave.sh    # Debug information
├── enclave-images/         # Generated EIF files
└── README-ENCLAVE.md       # This file
```

## 🔒 Security Features

- **Isolation**: Complete isolation from host OS
- **Attestation**: Cryptographic proof of enclave integrity
- **Secure Communication**: vsock for host-enclave communication
- **No SSH/Shell**: Enclave has no remote access capabilities
- **Immutable**: Enclave image cannot be modified at runtime

## 📊 Monitoring

### Health Checks
The application includes built-in health checks:
- Docker health check every 30s
- `/health` endpoint for external monitoring
- Automatic restart on failure

### Logs
```bash
# Real-time logs
npm run enclave:logs

# System logs
journalctl -u nitro-enclaves-allocator

# Docker logs (if running locally)
docker logs <container_id>
```

## 🚨 Troubleshooting

If you encounter the "Empty reply from server" error:

1. **Run debug script**: `npm run enclave:debug`
2. **Check logs**: `npm run enclave:logs`
3. **Verify network**: `netstat -tulpn | grep 3000`
4. **Test locally**: `npm run docker:run` (to isolate enclave issues)
5. **Restart services**:
   ```bash
   sudo systemctl restart nitro-enclaves-allocator
   sudo systemctl restart docker
   npm run enclave:stop && npm run enclave:start
   ```

## 📚 Additional Resources

- [AWS Nitro Enclaves Documentation](https://docs.aws.amazon.com/enclaves/)
- [Nitro CLI Command Reference](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli.html)
- [Troubleshooting Guide](https://docs.aws.amazon.com/enclaves/latest/user/troubleshooting.html)