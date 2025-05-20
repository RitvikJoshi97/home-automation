const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios'); // Add axios for HTTP requests

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
let knownDevices = new Map();
let knownDevicesOrder = []; // Store devices in order of priority

// Weather cache to avoid repeated API calls
const weatherCache = new Map();
const WEATHER_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

// Load known devices from CSV
function loadKnownDevices() {
  try {
    const csvFilePath = path.join(__dirname, 'known_devices.csv');
    const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    knownDevices.clear();
    knownDevicesOrder = []; // Clear the order array
    
    // Process records in order (top of file = highest priority)
    records.forEach((record, index) => {
      try {
        record.preferences = JSON.parse(record.preferences);
      } catch (e) {
        record.preferences = {};
      }
      // Add priority field based on position in file
      record.priority = index;
      const mac = record.mac.toLowerCase();
      knownDevices.set(mac, record);
      knownDevicesOrder.push(mac); // Store MAC addresses in priority order
    });

    console.log(`[${new Date().toISOString()}] Loaded ${knownDevices.size} known devices with priority order`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error loading known devices:`, error);
  }
}

// Save known devices to CSV
function saveKnownDevices() {
  try {
    const csvFilePath = path.join(__dirname, 'known_devices.csv');
    
    // Convert devices to records in priority order
    const records = knownDevicesOrder.map(mac => {
      const device = knownDevices.get(mac);
      return {
        mac: device.mac,
        name: device.name,
        preferences: JSON.stringify(device.preferences)
      };
    });

    const csvContent = stringify(records, {
      header: true,
      columns: ['mac', 'name', 'preferences']
    });

    fs.writeFileSync(csvFilePath, csvContent);
    console.log(`[${new Date().toISOString()}] Saved ${records.length} known devices to CSV in priority order`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error saving known devices:`, error);
  }
}

// Add new device to known devices
function addNewDevice(device) {
  const mac = device.mac.toLowerCase();
  if (!knownDevices.has(mac)) {
    // Clean up the hostname to ensure it's valid
    let cleanHostname = device.hostname || 'Unknown';
    // Remove any special characters and spaces
    cleanHostname = cleanHostname.replace(/[^a-zA-Z0-9-]/g, '');
    // Ensure it's not empty after cleaning
    if (!cleanHostname) cleanHostname = 'Unknown';
    
    const newDevice = {
      mac: device.mac,
      name: cleanHostname,
      preferences: {
        type: 'unknown',
        location: 'unknown'
      },
      priority: knownDevicesOrder.length // Set priority to end of list
    };
    knownDevices.set(mac, newDevice);
    knownDevicesOrder.push(mac); // Add to end of priority list
    console.log(`[${new Date().toISOString()}] Added new device to known devices: ${device.mac} with name ${newDevice.name} and priority ${newDevice.priority}`);
    saveKnownDevices();
  }
}

// Load known devices on startup
loadKnownDevices();

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

app.get('/api/devices', (req, res) => {
  loadKnownDevices(); // Reload known devices from CSV
  console.log(`[${new Date().toISOString()}] GET /api/devices - Returning ${devices.length} devices`);
  
  // Deduplicate devices by MAC address
  const uniqueDevicesMap = new Map();
  devices.forEach(device => {
    uniqueDevicesMap.set(device.mac.toLowerCase(), device);
  });
  
  const uniqueDevices = Array.from(uniqueDevicesMap.values());
  
  // Print known devices order for debugging
  console.log(`[${new Date().toISOString()}] Known devices priority order:`);
  knownDevicesOrder.forEach((mac, index) => {
    const device = knownDevices.get(mac);
    console.log(`  ${index}: ${mac} (${device.name})`);
  });
  
  // Sort devices by priority (if they are known)
  uniqueDevices.sort((a, b) => {
    const macA = a.mac.toLowerCase();
    const macB = b.mac.toLowerCase();
    
    // If both are known devices, sort by priority
    if (knownDevices.has(macA) && knownDevices.has(macB)) {
      const indexA = knownDevicesOrder.indexOf(macA);
      const indexB = knownDevicesOrder.indexOf(macB);
      // The lower the index in knownDevicesOrder, the higher the priority
      // So we want lower indices to come first in the sorted array
      return indexA - indexB;
    }
    
    // Known devices come before unknown devices
    if (knownDevices.has(macA)) return -1;
    if (knownDevices.has(macB)) return 1;
    
    // If neither is known, maintain original order
    return 0;
  });
  
  // Print order after sorting for debugging
  console.log(`[${new Date().toISOString()}] Devices order after sorting:`);
  uniqueDevices.forEach((device, index) => {
    console.log(`  ${index}: ${device.mac} (${device.name || device.hostname || 'Unknown'})`);
  });
  
  res.json(uniqueDevices);
});

app.get('/api/known-devices', (req, res) => {
  loadKnownDevices(); // Reload known devices from CSV
  res.json(Array.from(knownDevices.values()));
});

app.post('/api/devices', (req, res) => {
  loadKnownDevices(); // Reload known devices from CSV
  const timestamp = new Date().toISOString();
  const newDevices = req.body;
  
  if (!Array.isArray(newDevices)) {
    console.log(`[${timestamp}] Error: Received non-array data`);
    return res.status(400).json({ error: 'Expected array of devices' });
  }

  console.log(`[${timestamp}] POST /api/devices - Received ${newDevices.length} device(s)`);
  
  // Add new devices to known devices
  newDevices.forEach(device => addNewDevice(device));
  
  // Enhance devices with known device information
  devices = newDevices.map(device => {
    const knownDevice = knownDevices.get(device.mac.toLowerCase());
    if (knownDevice) {
      return {
        ...device,
        name: knownDevice.name,
        preferences: knownDevice.preferences,
        isKnown: true
      };
    }
    return {
      ...device,
      isKnown: false
    };
  });

  // Log the devices being received
  devices.forEach(device => {
    console.log(`[${timestamp}] Device: ${device.mac} (${device.name || device.hostname || 'Unknown'}) - ${device.ip}`);
  });
  
  console.log(`[${timestamp}] Updated device count: ${devices.length}`);
  res.json({ success: true, count: devices.length });
});

// Add endpoint to update device name
app.put('/api/devices/:mac/name', (req, res) => {
  const { mac } = req.params;
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const device = knownDevices.get(mac.toLowerCase());
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  device.name = name;
  saveKnownDevices();
  
  res.json({ success: true, device });
});

// Add endpoint to update device priority
app.put('/api/devices/:mac/priority', (req, res) => {
  const { mac } = req.params;
  const { priority } = req.body;
  
  if (priority === undefined || priority < 0) {
    return res.status(400).json({ error: 'Valid priority is required' });
  }

  const lowercaseMac = mac.toLowerCase();
  const device = knownDevices.get(lowercaseMac);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  // Remove from current position
  const currentIndex = knownDevicesOrder.indexOf(lowercaseMac);
  if (currentIndex !== -1) {
    knownDevicesOrder.splice(currentIndex, 1);
  }

  // Insert at new position (bound to array length)
  const newPriority = Math.min(priority, knownDevicesOrder.length);
  knownDevicesOrder.splice(newPriority, 0, lowercaseMac);
  
  // Update priority values for all devices
  knownDevicesOrder.forEach((mac, index) => {
    const dev = knownDevices.get(mac);
    if (dev) {
      dev.priority = index;
    }
  });

  saveKnownDevices();
  
  res.json({ 
    success: true, 
    device: knownDevices.get(lowercaseMac),
    message: `Device priority changed to ${newPriority}` 
  });
});

// Add endpoint to update device preferences
app.put('/api/devices/:mac/preferences', (req, res) => {
  const { mac } = req.params;
  const { preferences } = req.body;
  
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'Valid preferences object is required' });
  }

  const device = knownDevices.get(mac.toLowerCase());
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  // Update preferences
  device.preferences = {
    ...device.preferences,
    ...preferences
  };
  saveKnownDevices();
  
  res.json({ 
    success: true, 
    device,
    message: `Device preferences updated successfully` 
  });
});

// Add endpoint to get weather for a location
app.get('/api/weather/:location', async (req, res) => {
  try {
    const { location } = req.params;
    
    // For debugging
    console.log(`[${new Date().toISOString()}] Weather request for location: ${location}`);
    
    // Check if weather data is in cache and not expired
    const cachedWeather = weatherCache.get(location);
    if (cachedWeather && (Date.now() - cachedWeather.timestamp < WEATHER_CACHE_DURATION)) {
      console.log(`[${new Date().toISOString()}] Returning cached weather data for ${location}`);
      return res.json(cachedWeather.data);
    }
    
    console.log(`[${new Date().toISOString()}] Fetching weather data for ${location}`);
    
    // First, geocode the location to get coordinates
    console.log(`[${new Date().toISOString()}] Geocoding request for: ${location}`);

    // Clean up the location string - split by comma and use the last part if it contains multiple parts
    let searchLocation = location;
    if (location.includes(',')) {
      // For "Newham, London", we'll try "London" if the full search fails
      const parts = location.split(',').map(part => part.trim());
      searchLocation = parts[parts.length - 1]; // Get the last part (usually the city)
      console.log(`[${new Date().toISOString()}] Location has multiple parts, will try last part: ${searchLocation}`);
    }

    try {
      // First try with original location
      const geocodingResponse = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: {
          name: location,
          count: 1,
          language: 'en',
          format: 'json'
        }
      });
      
      console.log(`[${new Date().toISOString()}] Geocoding response:`, geocodingResponse.data);
      
      // If no results with full location, try with the last part (e.g., "London" instead of "Newham, London")
      if (!geocodingResponse.data.results || geocodingResponse.data.results.length === 0) {
        if (location !== searchLocation) {
          console.log(`[${new Date().toISOString()}] Trying simplified location: ${searchLocation}`);
          
          const simplifiedGeocodingResponse = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: {
              name: searchLocation,
              count: 1,
              language: 'en',
              format: 'json'
            }
          });
          
          console.log(`[${new Date().toISOString()}] Simplified geocoding response:`, simplifiedGeocodingResponse.data);
          
          if (simplifiedGeocodingResponse.data.results && simplifiedGeocodingResponse.data.results.length > 0) {
            // We found results with the simplified location
            const geoResult = simplifiedGeocodingResponse.data.results[0];
            console.log(`[${new Date().toISOString()}] Geocoded ${searchLocation} to coordinates: ${geoResult.latitude}, ${geoResult.longitude}`);
            
            // Now fetch weather using the coordinates
            const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
              params: {
                latitude: geoResult.latitude,
                longitude: geoResult.longitude,
                current: 'temperature_2m,temperature_2m_max,temperature_2m_min,relative_humidity_2m,is_day,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m',
                hourly: 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,precipitation_probability',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max',
                timezone: 'auto',
                forecast_days: 3
              }
            });

            // Process the weather data
            const weatherData = weatherResponse.data;
            
            // Add a human-readable condition and light/dark mode recommendation
            const processedData = {
              ...weatherData,
              location: {
                name: location, // Use original location name for display
                displayName: geoResult.name,
                country: geoResult.country,
                latitude: geoResult.latitude,
                longitude: geoResult.longitude
              },
              current: {
                ...weatherData.current,
                condition: getWeatherCondition(weatherData.current.weather_code),
                prefersDarkMode: shouldUseDarkMode(weatherData.current)
              },
              // Process daily forecast data
              forecast: weatherData.daily.time.map((time, index) => ({
                date: time,
                condition: getWeatherCondition(weatherData.daily.weather_code[index]),
                max: weatherData.daily.temperature_2m_max[index],
                min: weatherData.daily.temperature_2m_min[index],
                precipitation_probability: weatherData.daily.precipitation_probability_max[index],
                weather_code: weatherData.daily.weather_code[index]
              }))
            };
            
            // Cache the weather data
            weatherCache.set(location, {
              timestamp: Date.now(),
              data: processedData
            });
            
            return res.json(processedData);
          }
        }
        
        // If we still have no results, use default coordinates for London
        console.log(`[${new Date().toISOString()}] Geocoding failed, using default coordinates for London`);
        const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
          params: {
            latitude: 51.5074,
            longitude: -0.1278,
            current: 'temperature_2m,temperature_2m_max,temperature_2m_min,relative_humidity_2m,is_day,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m',
            hourly: 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,precipitation_probability',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max',
            timezone: 'auto',
            forecast_days: 3
          }
        });
        
        // Process the weather data
        const weatherData = weatherResponse.data;
        
        // Add a human-readable condition and light/dark mode recommendation
        const processedData = {
          ...weatherData,
          location: {
            name: "London",
            displayName: "London",
            country: "United Kingdom",
            latitude: 51.5074,
            longitude: -0.1278
          },
          current: {
            ...weatherData.current,
            condition: getWeatherCondition(weatherData.current.weather_code),
            prefersDarkMode: shouldUseDarkMode(weatherData.current)
          },
          // Process daily forecast data
          forecast: weatherData.daily.time.map((time, index) => ({
            date: time,
            condition: getWeatherCondition(weatherData.daily.weather_code[index]),
            max: weatherData.daily.temperature_2m_max[index],
            min: weatherData.daily.temperature_2m_min[index],
            precipitation_probability: weatherData.daily.precipitation_probability_max[index],
            weather_code: weatherData.daily.weather_code[index]
          }))
        };
        
        // Cache the weather data
        weatherCache.set(location, {
          timestamp: Date.now(),
          data: processedData
        });
        
        return res.json(processedData);
      }
      
      const geoResult = geocodingResponse.data.results[0];
      console.log(`[${new Date().toISOString()}] Geocoded ${location} to coordinates: ${geoResult.latitude}, ${geoResult.longitude}`);
      
      // Now fetch weather using the coordinates
      const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: geoResult.latitude,
          longitude: geoResult.longitude,
          current: 'temperature_2m,temperature_2m_max,temperature_2m_min,relative_humidity_2m,is_day,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m',
          hourly: 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,precipitation_probability',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max',
          timezone: 'auto',
          forecast_days: 3
        }
      });

      // Process the weather data
      const weatherData = weatherResponse.data;
      
      // Add a human-readable condition and light/dark mode recommendation
      const processedData = {
        ...weatherData,
        location: {
          name: geoResult.name,
          country: geoResult.country,
          latitude: geoResult.latitude,
          longitude: geoResult.longitude
        },
        current: {
          ...weatherData.current,
          condition: getWeatherCondition(weatherData.current.weather_code),
          prefersDarkMode: shouldUseDarkMode(weatherData.current)
        },
        // Process daily forecast data
        forecast: weatherData.daily.time.map((time, index) => ({
          date: time,
          condition: getWeatherCondition(weatherData.daily.weather_code[index]),
          max: weatherData.daily.temperature_2m_max[index],
          min: weatherData.daily.temperature_2m_min[index],
          precipitation_probability: weatherData.daily.precipitation_probability_max[index],
          weather_code: weatherData.daily.weather_code[index]
        }))
      };
      
      // Cache the weather data
      weatherCache.set(location, {
        timestamp: Date.now(),
        data: processedData
      });
      
      res.json(processedData);
    } catch (apiError) {
      console.error(`[${new Date().toISOString()}] API Error:`, apiError.message);
      
      // Fallback to a mock weather response if API calls fail
      const mockWeatherData = {
        location: {
          name: location,
          country: "Unknown",
          latitude: 0,
          longitude: 0
        },
        current: {
          temperature_2m: 20,
          temperature_2m_max: 25,
          temperature_2m_min: 15,
          relative_humidity_2m: 65,
          is_day: 1,
          weather_code: 0,
          cloud_cover: 10,
          precipitation: 0,
          wind_speed_10m: 0,
          wind_direction_10m: 0,
          condition: "Clear sky",
          prefersDarkMode: false
        },
        hourly: {
          time: [new Date().toISOString()],
          temperature_2m: [20],
          weather_code: [0],
          relative_humidity_2m: [65],
          weather_code: [0],
          precipitation_probability: [0]
        },
        daily: {
          time: [new Date().toISOString()],
          weather_code: [0],
          temperature_2m_max: [25],
          temperature_2m_min: [15],
          precipitation_sum: [0],
          precipitation_probability_max: [0]
        }
      };
      
      res.json(mockWeatherData);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching weather:`, error);
    res.status(500).json({ error: 'Error fetching weather data', message: error.message });
  }
});

// Helper function to determine weather condition from weather code
function getWeatherCondition(weatherCode) {
  // WMO Weather interpretation codes (https://open-meteo.com/en/docs)
  const weatherConditions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  };
  
  return weatherConditions[weatherCode] || 'Unknown';
}

// Helper function to determine if dark mode should be used based on weather conditions
function shouldUseDarkMode(currentWeather) {
  // Use dark mode if it's night time
  if (!currentWeather.is_day) {
    return true;
  }
  
  // Use dark mode for cloudy, stormy, or rainy weather
  const cloudyWeatherCodes = [2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  if (cloudyWeatherCodes.includes(currentWeather.weather_code)) {
    return true;
  }
  
  // If cloud cover is high, use dark mode
  if (currentWeather.cloud_cover > 70) {
    return true;
  }
  
  // Otherwise use light mode
  return false;
}

const PORT = 5002;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] API server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Ready to receive device updates`);
});