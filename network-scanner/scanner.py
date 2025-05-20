#!/usr/bin/env python3
import subprocess
import json
import requests
import time
import sys
import os
import re
import platform
import socket
import logging
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("NetworkScanner")

# Global configuration
CONFIG = {
    'api_url': 'http://localhost:5002/api/devices',
    'scan_interval': 10,  # seconds
    'debugging': True,  # Set to True for verbose output
}

def is_tool_available(name):
    """Check if a command-line tool is available."""
    try:
        subprocess.run(['which', name], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError:
        return False

def get_os_type():
    """Detect the operating system."""
    system = platform.system().lower()
    if 'darwin' in system:
        return 'macos'
    elif 'linux' in system:
        return 'linux'
    elif 'windows' in system:
        return 'windows'
    else:
        return 'unknown'

def is_root():
    """Check if the script is running with root/admin privileges."""
    return os.geteuid() == 0 if not platform.system().lower() == 'windows' else True

def get_default_interface():
    """Get the default network interface name."""
    os_type = get_os_type()
    
    try:
        if os_type == 'macos':
            # Get default route interface on macOS
            result = subprocess.run(['route', 'get', 'default'], capture_output=True, text=True)
            for line in result.stdout.split('\n'):
                if 'interface:' in line:
                    return line.split(':')[1].strip()
            
            # Fallback - get active interfaces
            result = subprocess.run(['networksetup', '-listallhardwareports'], capture_output=True, text=True)
            for line in result.stdout.split('\n'):
                if 'Device:' in line:
                    return line.split(':')[1].strip()
        
        elif os_type == 'linux':
            # Use ip route to get default interface on Linux
            result = subprocess.run(['ip', 'route', 'get', '8.8.8.8'], capture_output=True, text=True)
            match = re.search(r'dev\s+(\S+)', result.stdout)
            if match:
                return match.group(1)
            
            # Fallback - use ip link
            result = subprocess.run(['ip', 'link', 'show', 'up'], capture_output=True, text=True)
            lines = result.stdout.split('\n')
            for i, line in enumerate(lines):
                if i % 2 == 0 and 'LOOPBACK' not in line.upper():
                    match = re.search(r'^\d+:\s+(\S+):', line)
                    if match:
                        return match.group(1)
    except Exception as e:
        logger.error(f"Error detecting default interface: {e}")
    
    return None

def get_interface_ip(interface):
    """Get the IP address for a given interface."""
    os_type = get_os_type()
    try:
        if os_type == 'macos':
            result = subprocess.run(['ipconfig', 'getifaddr', interface], capture_output=True, text=True)
            return result.stdout.strip()
        elif os_type == 'linux':
            result = subprocess.run(['ip', '-4', 'addr', 'show', interface], capture_output=True, text=True)
            match = re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)', result.stdout)
            if match:
                return match.group(1)
    except Exception as e:
        logger.error(f"Error getting IP for interface {interface}: {e}")
    
    return None

def scan_with_arp_scan(interface=None):
    """Scan the network using arp-scan."""
    if not is_root():
        logger.error("arp-scan requires root privileges")
        return []
    
    if not interface:
        interface = get_default_interface()
        if not interface:
            logger.error("Failed to determine network interface")
            return []
    
    logger.info(f"Scanning network with arp-scan on interface {interface}")
    
    try:
        cmd = ['arp-scan', '--interface', interface, '--localnet']
        logger.debug(f"Running command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode not in [0, 1]:  # arp-scan returns 1 when it finds hosts
            logger.error(f"arp-scan error: {result.stderr}")
            return []
        
        devices = []
        lines = result.stdout.split('\n')
        
        # Skip header (first 2 lines) and footer (last 3 lines if not empty)
        start_idx = 2
        end_idx = len(lines) - 3 if len(lines) > 5 else len(lines)
        
        # Print first few lines for debugging
        if CONFIG['debugging']:
            logger.debug(f"arp-scan output sample: {lines[:min(7, len(lines))]}")
        
        for line in lines[start_idx:end_idx]:
            if not line.strip():
                continue
            
            # Split by whitespace but keep entries
            parts = re.split(r'\s+', line.strip())
            
            if len(parts) < 2:
                continue
            
            # First part is IP, second is MAC
            ip = parts[0]
            mac = parts[1]
            
            # Validate IP and MAC
            if not is_valid_ip(ip) or not is_valid_mac(mac):
                continue
                
            # Hostname might be in parts[2:] or empty
            hostname = ' '.join(parts[2:]) if len(parts) > 2 else ''
            
            devices.append({
                'ip': ip,
                'mac': mac,
                'hostname': hostname.strip() if hostname else 'Unknown',
                'last_seen': datetime.now().isoformat()
            })
        
        return devices
    except Exception as e:
        logger.error(f"Error during arp-scan: {e}")
        return []

def scan_with_arp_command():
    """Scan the network using the arp command."""
    logger.info("Scanning network with arp command")
    
    try:
        if get_os_type() == 'macos':
            cmd = ['arp', '-a']
        else:  # Linux
            cmd = ['arp', '-n']
            
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"arp command error: {result.stderr}")
            return []
        
        devices = []
        lines = result.stdout.split('\n')
        
        # Print first few lines for debugging
        if CONFIG['debugging']:
            logger.debug(f"arp command output sample: {lines[:min(5, len(lines))]}")
        
        # Different parsing for macOS and Linux
        if get_os_type() == 'macos':
            # macOS format: hostname (ip) at mac on interface
            pattern = r'(\S+)?\s*\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]+)'
            for line in lines:
                match = re.search(pattern, line)
                if match:
                    hostname = match.group(1) or 'Unknown'
                    ip = match.group(2)
                    mac = match.group(3)
                    
                    # Validate IP and MAC
                    if not is_valid_ip(ip) or not is_valid_mac(mac):
                        continue
                        
                    devices.append({
                        'ip': ip,
                        'mac': mac,
                        'hostname': hostname,
                        'last_seen': datetime.now().isoformat()
                    })
        else:  # Linux
            # Linux format: IP address HW type Address flags Mask hostname
            pattern = r'(\d+\.\d+\.\d+\.\d+)\s+\S+\s+([0-9a-fA-F:]+)'
            for line in lines:
                match = re.search(pattern, line)
                if match:
                    ip = match.group(1)
                    mac = match.group(2)
                    
                    # Validate IP and MAC
                    if not is_valid_ip(ip) or not is_valid_mac(mac):
                        continue
                    
                    # Try to resolve hostname
                    try:
                        hostname = socket.getfqdn(ip)
                        hostname = hostname if hostname != ip else 'Unknown'
                    except:
                        hostname = 'Unknown'
                    
                    devices.append({
                        'ip': ip,
                        'mac': mac,
                        'hostname': hostname,
                        'last_seen': datetime.now().isoformat()
                    })
        
        return devices
    except Exception as e:
        logger.error(f"Error during arp command: {e}")
        return []

def scan_with_ip_neigh():
    """Scan the network using ip neigh on Linux."""
    if get_os_type() != 'linux':
        return []
        
    logger.info("Scanning network with ip neigh")
    
    try:
        cmd = ['ip', 'neigh', 'show']
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"ip neigh error: {result.stderr}")
            return []
        
        devices = []
        lines = result.stdout.split('\n')
        
        # Print first few lines for debugging
        if CONFIG['debugging']:
            logger.debug(f"ip neigh output sample: {lines[:min(5, len(lines))]}")
        
        # Format: IP dev INTERFACE lladdr MAC ADDR state STATE
        pattern = r'(\d+\.\d+\.\d+\.\d+).*?\s+lladdr\s+([0-9a-fA-F:]+)'
        for line in lines:
            match = re.search(pattern, line)
            if match and 'REACHABLE' in line:
                ip = match.group(1)
                mac = match.group(2)
                
                # Validate IP and MAC
                if not is_valid_ip(ip) or not is_valid_mac(mac):
                    continue
                
                # Try to resolve hostname
                try:
                    hostname = socket.getfqdn(ip)
                    hostname = hostname if hostname != ip else 'Unknown'
                except:
                    hostname = 'Unknown'
                
                devices.append({
                    'ip': ip,
                    'mac': mac,
                    'hostname': hostname,
                    'last_seen': datetime.now().isoformat()
                })
        
        return devices
    except Exception as e:
        logger.error(f"Error during ip neigh: {e}")
        return []

def ping_sweep(network_prefix):
    """Perform a ping sweep to identify active hosts."""
    logger.info(f"Performing ping sweep on network {network_prefix}.0/24")
    
    active_ips = []
    for host in range(1, 255):
        ip = f"{network_prefix}.{host}"
        
        try:
            # Use the appropriate ping command
            if get_os_type() == 'windows':
                cmd = ['ping', '-n', '1', '-w', '200', ip]
            else:  # Linux or macOS
                cmd = ['ping', '-c', '1', '-W', '1', ip]
            
            # Run ping with a timeout to prevent hanging
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=1)
            
            if result.returncode == 0:
                active_ips.append(ip)
        except subprocess.TimeoutExpired:
            # Skip IPs that timeout
            pass
        except Exception as e:
            logger.error(f"Error pinging {ip}: {e}")
    
    return active_ips

def is_valid_ip(ip):
    """Validate IP address format."""
    try:
        parts = ip.split('.')
        return (
            len(parts) == 4 and
            all(0 <= int(part) <= 255 for part in parts)
        )
    except (ValueError, AttributeError):
        return False

def is_valid_mac(mac):
    """Validate MAC address format."""
    # Accept common MAC formats (00:11:22:33:44:55, 00-11-22-33-44-55, etc.)
    pattern = r'^([0-9a-fA-F]{1,2}[:-]){5}([0-9a-fA-F]{1,2})$'
    return bool(re.match(pattern, mac))

def normalize_mac(mac):
    """Normalize MAC address format to lowercase with colons."""
    # Remove all non-hex characters
    clean_mac = re.sub(r'[^0-9a-fA-F]', '', mac.lower())
    
    # Insert colons
    chunks = [clean_mac[i:i+2] for i in range(0, len(clean_mac), 2)]
    return ':'.join(chunks[:6])  # Ensure we only get 6 pairs

def scan_network():
    """Scan the network using the best available method."""
    devices = []
    
    # Try arp-scan first (most accurate but needs root)
    if is_tool_available('arp-scan') and is_root():
        devices = scan_with_arp_scan()
    
    # If no results or arp-scan failed, try arp command
    if not devices and is_tool_available('arp'):
        devices = scan_with_arp_command()
    
    # On Linux, try ip neigh as another option
    if not devices and get_os_type() == 'linux' and is_tool_available('ip'):
        devices = scan_with_ip_neigh()
    
    # If we still have no results, try a ping sweep
    if not devices:
        interface = get_default_interface()
        if interface:
            ip = get_interface_ip(interface)
            if ip:
                network_prefix = '.'.join(ip.split('.')[:3])
                active_ips = ping_sweep(network_prefix)
                
                # For each active IP, try to get MAC from arp cache
                for active_ip in active_ips:
                    try:
                        if get_os_type() == 'macos':
                            cmd = ['arp', '-n', active_ip]
                        else:  # Linux
                            cmd = ['arp', '-a', active_ip]
                        
                        result = subprocess.run(cmd, capture_output=True, text=True)
                        
                        if get_os_type() == 'macos':
                            match = re.search(r'at\s+([0-9a-fA-F:]+)', result.stdout)
                        else:  # Linux
                            match = re.search(r'([0-9a-fA-F:]+)[^\n]+', result.stdout)
                            
                        if match:
                            mac = match.group(1)
                            
                            # Try to resolve hostname
                            try:
                                hostname = socket.getfqdn(active_ip)
                                hostname = hostname if hostname != active_ip else 'Unknown'
                            except:
                                hostname = 'Unknown'
                            
                            devices.append({
                                'ip': active_ip,
                                'mac': mac,
                                'hostname': hostname,
                                'last_seen': datetime.now().isoformat()
                            })
                    except Exception as e:
                        logger.error(f"Error getting MAC for {active_ip}: {e}")
    
    # Normalize and validate
    normalized_devices = []
    seen_macs = set()
    
    for device in devices:
        try:
            # Skip invalid entries
            if not is_valid_ip(device['ip']) or not is_valid_mac(device['mac']):
                continue
            
            # Normalize MAC address
            norm_mac = normalize_mac(device['mac'])
            
            # Skip duplicate MACs
            if norm_mac in seen_macs:
                continue
                
            seen_macs.add(norm_mac)
            
            # Update the device with normalized MAC
            device['mac'] = norm_mac
            
            # Add to normalized list
            normalized_devices.append(device)
        except Exception as e:
            logger.error(f"Error normalizing device {device}: {e}")
    
    return normalized_devices

def send_to_api(devices):
    """Send devices to the API server."""
    if not devices:
        logger.info("No devices to send to API")
        return
    
    logger.info(f"Sending {len(devices)} devices to API at {CONFIG['api_url']}")
    
    try:
        response = requests.post(CONFIG['api_url'], json=devices)
        
        if response.status_code == 200:
            logger.info(f"Successfully sent device data to API: {response.text[:100]}")
        else:
            logger.error(f"Failed to send data to API: Status {response.status_code}")
            logger.error(f"Response: {response.text[:200]}")
    except requests.exceptions.ConnectionError:
        logger.error(f"Error: Could not connect to API server at {CONFIG['api_url']}")
    except Exception as e:
        logger.error(f"Error sending data to API: {e}")

def main():
    """Main function to run the scanner."""
    logger.info(f"Network Scanner starting on {get_os_type()} OS")
    
    # Check for root if needed
    if is_tool_available('arp-scan') and not is_root():
        logger.warning("Running without root privileges. Some scanning methods may not work.")
    
    # Detect available tools
    if is_tool_available('arp-scan'):
        logger.info("arp-scan is available")
    else:
        logger.warning("arp-scan is not installed. Will use alternative methods.")
    
    # Get the default interface
    interface = get_default_interface()
    logger.info(f"Default network interface: {interface}")
    
    # Get the IP on this interface
    if interface:
        ip = get_interface_ip(interface)
        logger.info(f"IP address on {interface}: {ip}")
    
    try:
        while True:
            logger.info(f"\n{'='*20} SCAN STARTED {'='*20}")
            
            # Scan for devices
            devices = scan_network()
            
            if devices:
                logger.info(f"Found {len(devices)} devices on the network")
                
                # Log the first few devices for debugging
                if CONFIG['debugging']:
                    for i, device in enumerate(devices[:3]):
                        logger.debug(f"Device {i+1}: {device}")
                
                # Send to API
                send_to_api(devices)
            else:
                logger.warning("No devices found on the network")
            
            logger.info(f"{'='*20} SCAN FINISHED {'='*20}")
            logger.info(f"Waiting {CONFIG['scan_interval']} seconds before next scan...")
            
            # Wait before next scan
            time.sleep(CONFIG['scan_interval'])
            
    except KeyboardInterrupt:
        logger.info("Stopping network scanner...")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Unhandled exception: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 