const API_KEY = '3e87f27f9ac9b7d9fb27c6034e561eb4';

document.getElementById('location').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') getForecast();
});

async function getForecast() {
    const locationInput = document.getElementById('location').value || '10001'; // Default: NYC zip
    let lat, lon, locationName;

    try {
        // Determine input type
        if (locationInput.includes(',')) {
            [lat, lon] = locationInput.split(',').map(Number);
            locationName = `Lat: ${lat}, Lon: ${lon}`;
        } else if (/^\d{5}$/.test(locationInput)) {
            ({ lat, lon, name: locationName } = await geocodeZip(locationInput));
        } else {
            ({ lat, lon, name: locationName } = await geocodeCity(locationInput));
        }

        // Fetch data
        const [sevenTimerData, openWeatherData] = await Promise.all([
            fetch7Timer(lat, lon),
            fetchOpenWeather(lat, lon) // Using basic weather endpoint
        ]);

        // Process current data from 7Timer! (first point)
        const sevenTimer = sevenTimerData.dataseries[0];
        const cloudCover7T = sevenTimer.cloudcover * 10;
        const temp7T = sevenTimer.temp2m * 9/5 + 32; // Fahrenheit
        const windSpeed7T = sevenTimer.wind10m.speed * 2.237; // MPH
        const humidity7T = sevenTimer.rh2m;
        const seeing = sevenTimer.seeing;
        const transparency = mapTransparency(sevenTimer.transparency);

        // Process current data from OpenWeatherMap
        const cloudCoverOW = openWeatherData.clouds.all;
        const tempOW = (openWeatherData.main.temp - 273.15) * 9/5 + 32; // Fahrenheit
        const windSpeedOW = openWeatherData.wind.speed * 2.237; // MPH
        const humidityOW = openWeatherData.main.humidity;

        // Average data
        const avgCloudCover = (cloudCover7T + cloudCoverOW) / 2;
        const avgTemp = (temp7T + tempOW) / 2;
        const avgWindSpeed = (windSpeed7T + windSpeedOW) / 2;
        const avgHumidity = (humidity7T + humidityOW) / 2;

        // Display current forecast
        const forecastHTML = `
            <div class="day-card">
                <h3>Current Conditions (${new Date().toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })})</h3>
                <p>Cloud Cover: ${avgCloudCover.toFixed(1)}%</p>
                <p>Temperature: ${avgTemp.toFixed(1)}°F</p>
                <p>Wind Speed: ${avgWindSpeed.toFixed(1)} MPH</p>
                <p>Humidity: ${avgHumidity.toFixed(1)}%</p>
                <p>Seeing: ${seeing}" (7Timer!)</p>
                <p>Transparency: ${transparency} (7Timer!)</p>
            </div>
        `;

        document.getElementById('forecast').innerHTML = `<h2>${locationName}</h2>${forecastHTML}`;
    } catch (error) {
        console.error('Error fetching forecast:', error);
        document.getElementById('forecast').innerHTML = `<h2>Error</h2><p>Could not fetch forecast. Check your API key or try again later.</p>`;
    }
}

// Geocode city name
async function geocodeCity(city) {
    const response = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`);
    if (!response.ok) throw new Error('Geocoding failed');
    const data = await response.json();
    return { lat: data[0].lat, lon: data[0].lon, name: data[0].name };
}

// Geocode zip code
async function geocodeZip(zip) {
    const response = await fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${zip},US&appid=${API_KEY}`);
    if (!response.ok) throw new Error('Zip code geocoding failed');
    const data = await response.json();
    return { lat: data.lat, lon: data.lon, name: data.name };
}

// Fetch 7Timer! ASTRO data
async function fetch7Timer(lat, lon) {
    const response = await fetch(`https://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json`);
    if (!response.ok) throw new Error('7Timer! fetch failed');
    return await response.json();
}

// Fetch OpenWeatherMap basic weather data
async function fetchOpenWeather(lat, lon) {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
    if (!response.ok) throw new Error('OpenWeatherMap fetch failed: ' + response.status);
    return await response.json();
}

// Map transparency
function mapTransparency(value) {
    const scale = { 1: 'Excellent', 2: 'Good', 3: 'Average', 4: 'Below Avg', 5: 'Poor', 6: 'Very Poor', 7: 'Terrible' };
    return scale[value] || 'Unknown';
}
