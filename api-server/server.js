const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

// Store the latest device data
let latestDevices = [];

app.use(cors());
app.use(express.json());

// Endpoint to receive device data from Python scanner
app.post('/api/devices', (req, res) => {
    latestDevices = req.body;
    res.json({ status: 'success' });
});

// Endpoint to get device data for the frontend
app.get('/api/devices', (req, res) => {
    res.json(latestDevices);
});

app.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
});