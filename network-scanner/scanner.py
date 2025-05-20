import scapy.all as scapy
import requests
import time
import json
from datetime import datetime
import socket
import netifaces

def get_network_devices():
    # Get the default gateway interface
    gateways = netifaces.gateways()
    default_gateway = gateways['default'][netifaces.AF_INET][1]
    
    # Get the IP address of the interface
    interface_ip = netifaces.ifaddresses(default_gateway)[netifaces.AF_INET][0]['addr']
    network = '.'.join(interface_ip.split('.')[:-1]) + '.0/24'
    
    # Create ARP request packet
    arp_request = scapy.ARP(pdst=network)
    broadcast = scapy.Ether(dst="ff:ff:ff:ff:ff:ff")
    arp_request_broadcast = broadcast/arp_request
    
    # Send packet and get response
    answered_list = scapy.srp(arp_request_broadcast, timeout=1, verbose=False)[0]
    
    devices = []
    for element in answered_list:
        ip = element[1].psrc
        mac = element[1].hwsrc
        try:
            hostname = socket.gethostbyaddr(ip)[0]
        except:
            hostname = "Unknown"
            
        devices.append({
            "ip": ip,
            "mac": mac,
            "hostname": hostname,
            "last_seen": datetime.now().isoformat()
        })
    
    return devices

def send_to_api(devices):
    api_url = "http://localhost:3000/api/devices"
    try:
        response = requests.post(api_url, json=devices)
        print(f"Data sent to API. Status: {response.status_code}")
    except Exception as e:
        print(f"Error sending data to API: {e}")

def main():
    while True:
        try:
            devices = get_network_devices()
            send_to_api(devices)
            time.sleep(60)  # Scan every minute
        except Exception as e:
            print(f"Error in main loop: {e}")
            time.sleep(60)

if __name__ == "__main__":
    main() 