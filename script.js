async function getForecast() {
    const locationInput = document.getElementById('location').value || '10001'; // Default: NYC zip
    let lat, lon, locationName;

    // Determine if input is lat,lon, zip code, or city
    if (locationInput.includes(',')) {
        [lat, lon] = locationInput.split(',').map(Number);
        locationName = `Lat: ${lat}, Lon: ${lon}`;
    } else if (/^\d{5}$/.test(locationInput)) {
        // Zip code
        ({ lat, lon, name: locationName } = await geocodeZip(locationInput));
    } else {
        // City name
        ({ lat, lon, name: locationName } = await geocodeCity(locationInput));
    }

    // Fetch data from multiple sources
    const [sevenTimerData, openWeatherData] = await Promise.all([
        fetch7Timer(lat, lon),
        fetchOpenWeather(lat, lon)
    ]);

    // Process 7Timer! data (first forecast point)
    const sevenTimer = sevenTimerData.dataseries[0];
    const cloudCover7T = sevenTimer.cloudcover * 10; // 0-10 scale to percentage
    const transparency7T = mapTransparency(sevenTimer.transparency); // 1-7 scale
    const seeing7T = sevenTimer.seeing; // Arcseconds (1-5 typically)
    const temp7T = sevenTimer.temp2m; // Celsius
    const humidity7T = sevenTimer.rh2m; // Relative humidity %
    const windSpeed7T = sevenTimer.wind10m.speed; // m/s

    // Process OpenWeatherMap data
    const cloudCoverOW = openWeatherData.clouds.all; // 0-100%
    const tempOW = openWeatherData.main.temp - 273.15; // Kelvin to Celsius
    const humidityOW = openWeatherData.main.humidity; // %
    const windSpeedOW = openWeatherData.wind.speed; // m/s
    const precipProbOW = openWeatherData.weather[0].main.includes('Rain') ? 50 : 0; // Rough estimate

    // Average the data
    const avgCloudCover = (cloudCover7T + cloudCoverOW) / 2;
    const avgTemp = (temp7T + tempOW) / 2;
    const avgHumidity = (humidity7T + humidityOW) / 2;
    const avgWindSpeed = (windSpeed7T + windSpeedOW) / 2;

    // 7Timer! provides seeing and transparency directly; OpenWeatherMap doesn’t, so use 7Timer! values
    const seeing = seeing7T;
    const transparency = transparency7T;

    // Moon phase (approximate from current date, as APIs don’t provide it directly here)
    const moonPhase = getMoonPhase();

    // Display results
    document.getElementById('forecast').innerHTML = `
        <h2>Forecast for ${locationName}</h2>
        <p><strong>Average Cloud Cover:</strong> ${avgCloudCover.toFixed(1)}%</p>
        <p><strong>Transparency:</strong> ${transparency} (from 7Timer!)</p>
        <p><strong>Seeing:</strong> ${seeing} arcseconds (from 7Timer!)</p>
        <p><strong>Average Temperature:</strong> ${avgTemp.toFixed(1)}°C</p>
        <p><strong>Average Humidity:</strong> ${avgHumidity.toFixed(1)}%</p>
        <p><strong>Average Wind Speed:</strong> ${avgWindSpeed.toFixed(1)} m/s</p>
        <p><strong>Precipitation Probability:</strong> ${precipProbOW}% (from OpenWeatherMap)</p>
        <p><strong>Moon Phase:</strong> ${moonPhase}</p>
    `;
}

// Geocode city name to lat/lon
async function geocodeCity(city) {
    const apiKey = '3e87f27f9ac9b7d9fb27c6034e561eb4';
    const response = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${apiKey}`);
    const data = await response.json();
    return { lat: data[0].lat, lon: data[0].lon, name: data[0].name };
}

// Geocode zip code to lat/lon
async function geocodeZip(zip) {
    const apiKey = '3e87f27f9ac9b7d9fb27c6034e561eb4';
    const response = await fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${zip},US&appid=${apiKey}`);
    const data = await response.json();
    return { lat: data.lat, lon: data.lon, name: data.name };
}

// Fetch 7Timer! ASTRO data
async function fetch7Timer(lat, lon) {
    const response = await fetch(`https://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json`);
    return await response.json();
}

// Fetch OpenWeatherMap data
async function fetchOpenWeather(lat, lon) {
    const apiKey = 'YOUR_OPENWEATHERMAP_API_KEY';
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`);
    return await response.json();
}

// Map 7Timer! transparency (1-7) to a descriptive string
function mapTransparency(value) {
    const scale = {
        1: 'Excellent',
        2: 'Good',
        3: 'Average',
        4: 'Below Average',
        5: 'Poor',
        6: 'Very Poor',
        7: 'Terrible'
    };
    return scale[value] || 'Unknown';
}

// Approximate moon phase based on current date
function getMoonPhase() {
    const now = new Date();
    const lunarCycle = 29.53; // Days in a lunar cycle
    const knownNewMoon = new Date('2025-01-13'); // Reference new moon
    const daysSinceNewMoon = (now - knownNewMoon) / (1000 * 60 * 60 * 24);
    const phase = (daysSinceNewMoon % lunarCycle) / lunarCycle;
    if (phase < 0.05 || phase > 0.95) return 'New Moon';
    if (phase < 0.25) return 'Waxing Crescent';
    if (phase < 0.45) return 'First Quarter';
    if (phase < 0.55) return 'Waxing Gibbous';
    if (phase < 0.75) return 'Full Moon';
    if (phase < 0.95) return 'Waning Gibbous';
    return 'Last Quarter';
}
