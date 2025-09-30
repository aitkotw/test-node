import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible on all interfaces (0.0.0.0:${PORT})`);
  console.log(`Enclave environment: ${process.env.NODE_ENV || 'development'}`);
});