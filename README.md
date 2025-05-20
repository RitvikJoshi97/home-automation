# Home Automation Dashboard

A comprehensive home automation system that monitors network devices and displays information on a dashboard. The system consists of three main components:

1. Network Scanner (Python)
2. API Server (Node.js)
3. Dashboard (Next.js)

## Features

- Real-time network device detection
- Device presence monitoring
- Device prioritization for personalized greetings
- Weather information display
- Recipe suggestions
- Modern, responsive dashboard interface

## Prerequisites

- Python 3.8+
- Node.js 14+
- npm or yarn
- Network administrator privileges (for the scanner)

## Project Structure 
```
├── network-scanner/ # Python service for network device detection
├── api-server/ # Node.js API server
└── dashboard/ # Next.js frontend dashboard
```

## Installation

### Network Scanner

```bash
cd network-scanner
pip install -r requirements.txt
```

### API Server

```bash
cd api-server
npm install
```

### Dashboard

```bash
cd dashboard
npm install
```

## Configuration

1. Create a `.env` file in the `api-server` directory:
```env
PORT=3000
```

2. Create a `.env.local` file in the `dashboard` directory:
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Running the Application

1. Start the Network Scanner:
```bash
cd network-scanner
sudo python scanner.py
```

2. Start the API Server:
```bash
cd api-server
npm start
```

3. Start the Dashboard:
```bash
cd dashboard
npm run dev
```

The dashboard will be available at `http://localhost:3000`

## API Endpoints

### POST /api/devices
Receives device data from the network scanner.

### GET /api/devices
Returns the latest device data for the frontend, sorted by priority.

### PUT /api/devices/:mac/name
Updates the display name of a device.

### PUT /api/devices/:mac/priority
Updates the priority of a device, which affects greeting order.

### PUT /api/devices/:mac/preferences
Updates the preferences of a device (type, location, user, etc.).

## Device Priority System

The system includes a device priority feature that determines which user gets greeted on the dashboard:

1. Device priority is determined by the order in the `known_devices.csv` file
2. Devices at the top of the file have higher priority
3. When multiple known devices are present, the one with highest priority is greeted
4. New devices are added with lowest priority by default
5. Priorities can be modified using the API endpoint `/api/devices/:mac/priority`

This allows personalization of the dashboard based on which users should be prioritized for greetings and preferences.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Scapy](https://scapy.net/) for network scanning
- [Next.js](https://nextjs.org/) for the frontend framework
- [Express](https://expressjs.com/) for the API server

