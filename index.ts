import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});