import express from 'express';
import { EnclaveVsockServer } from './src/vsock-server';

const app = express();
const PORT = process.env.PORT || 3000;
const VSOCK_PORT = parseInt(process.env.VSOCK_PORT || '5000', 10);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'AWS MPC Enclave Service is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/enclave/status', (req, res) => {
  res.json({
    enclave: 'initialized',
    secure: true,
    ready: true
  });
});

app.post('/api/enclave/compute', (req, res) => {
  const { data } = req.body;
  res.json({
    result: 'computation completed',
    inputReceived: !!data,
    timestamp: new Date().toISOString()
  });
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`[HTTP Server] Running on port ${PORT}`);
});

// Start vsock server for parent instance communication
try {
  const vsockServer = new EnclaveVsockServer(VSOCK_PORT);
  vsockServer.listen();
  console.log('[Enclave] Vsock server started successfully');
} catch (err) {
  console.error('[Enclave] Failed to start vsock server:', err);
  console.error('[Enclave] This is expected if not running in an actual AWS Nitro Enclave');
}