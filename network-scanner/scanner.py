import subprocess
import json
import requests
import time
import sys
import os
from datetime import datetime

def check_arp_scan():
    try:
        subprocess.run(['which', 'arp-scan'], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError:
        print("Error: arp-scan is not installed. Please install it using:")
        print("  brew install arp-scan")
        return False

def check_root():
    if os.geteuid() != 0:
        print("Error: This script needs to be run with sudo privileges.")
        print("Please run it using:")
        print("  sudo python scanner.py")
        return False
    return True

def get_network_interface():
    try:
        # Get the default route interface
        result = subprocess.run(['route', 'get', 'default'], capture_output=True, text=True)
        for line in result.stdout.split('\n'):
            if 'interface:' in line:
                return line.split(':')[1].strip()
        return None
    except Exception as e:
        print(f"Error getting network interface: {e}")
        return None

def scan_network():
    interface = get_network_interface()
    if not interface:
        print("Could not determine network interface")
        return []

    try:
        # First, get the network range
        result = subprocess.run(['ipconfig', 'getifaddr', interface], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error getting IP address: {result.stderr}")
            return []
            
        ip = result.stdout.strip()
        network = '.'.join(ip.split('.')[:-1]) + '.0/24'
        
        # Run arp-scan with specific interface and network
        cmd = ['arp-scan', '--interface', interface, '--localnet']
        print(f"Running command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error running arp-scan: {result.stderr}")
            return []
            
        lines = result.stdout.split('\n')
        print(f"Raw output: {result.stdout[:200]}...")  # Print first 200 chars for debugging
        
        devices = []
        for line in lines[2:-3]:  # Skip header and footer lines
            if line.strip():
                parts = line.split()
                if len(parts) >= 2:
                    ip = parts[0]
                    mac = parts[1]
                    hostname = parts[2] if len(parts) > 2 else 'Unknown'
                    
                    devices.append({
                        'ip': ip,
                        'mac': mac,
                        'hostname': hostname,
                        'last_seen': datetime.now().isoformat()
                    })
        
        return devices
    except Exception as e:
        print(f"Error scanning network: {e}")
        return []

def send_to_api(devices):
    try:
        response = requests.post('http://localhost:5002/api/devices', json=devices)
        if response.status_code == 200:
            print("Successfully sent device data to API")
        else:
            print(f"Failed to send data to API: {response.status_code}")
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to API server. Make sure it's running at http://localhost:5002")
    except Exception as e:
        print(f"Error sending data to API: {e}")

def main():
    if not check_arp_scan():
        sys.exit(1)
        
    if not check_root():
        sys.exit(1)
        
    print("Starting network scanner...")
    print("Press Ctrl+C to stop")
    
    try:
        while True:
            print("\nScanning network...")
            devices = scan_network()
            if devices:
                print(f"Found {len(devices)} devices")
                send_to_api(devices)
            else:
                print("No devices found")
            
            # Wait for 10 seconds before next scan
            print("Waiting 10 seconds before next scan...")
            time.sleep(10)
    except KeyboardInterrupt:
        print("\nStopping network scanner...")
        sys.exit(0)

if __name__ == "__main__":
    main() 