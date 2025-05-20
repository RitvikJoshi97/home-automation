const express = require('express');
const cors = require('cors');
const app = express();

// Configure CORS
app.use(cors({
  origin: ['http://localhost:5001', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
}));

app.use(express.json());

// Store devices in memory (you might want to use a database in production)
let devices = [];

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

app.get('/api/devices', (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /api/devices - Returning ${devices.length} devices`);
  res.json(devices);
});

app.post('/api/devices', (req, res) => {
  const timestamp = new Date().toISOString();
  const newDevices = req.body;
  
  if (!Array.isArray(newDevices)) {
    console.log(`[${timestamp}] Error: Received non-array data`);
    return res.status(400).json({ error: 'Expected array of devices' });
  }

  console.log(`[${timestamp}] POST /api/devices - Received ${newDevices.length} device(s)`);
  
  // Log the devices being received
  newDevices.forEach(device => {
    console.log(`[${timestamp}] Device: ${device.mac} (${device.hostname || 'Unknown'}) - ${device.ip}`);
  });

  // Replace the entire devices array with the new data
  devices = newDevices;
  
  console.log(`[${timestamp}] Updated device count: ${devices.length}`);
  res.json({ success: true, count: devices.length });
});

const PORT = 5002;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] API server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Ready to receive device updates`);
});