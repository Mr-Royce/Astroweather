async function getForecast() {
    const location = document.getElementById('location').value || '40.7128,-74.0060'; // Default: NYC
    const [lat, lon] = location.includes(',') ? location.split(',') : await geocode(location);

    // Fetch data from multiple sources
    const [sevenTimerData, openWeatherData] = await Promise.all([
        fetch7Timer(lat, lon),
        fetchOpenWeather(lat, lon)
    ]);

    // Extract and average cloud cover
    const cloudCover7T = sevenTimerData.dataseries[0].cloudcover * 10; // 7Timer uses 0-10 scale
    const cloudCoverOW = openWeatherData.clouds.all; // OpenWeather uses 0-100%
    const avgCloudCover = (cloudCover7T + cloudCoverOW) / 2;

    // Display results
    document.getElementById('forecast').innerHTML = `
        <h2>Forecast for ${location}</h2>
        <p>Average Cloud Cover: ${avgCloudCover.toFixed(1)}%</p>
        <p>More data coming soon...</p>
    `;
}

// Geocode city name to lat/lon (using OpenWeatherMap's geocoding API)
async function geocode(city) {
    const apiKey = '3e87f27f9ac9b7d9fb27c6034e561eb4';
    const response = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${apiKey}`);
    const data = await response.json();
    return [data[0].lat, data[0].lon];
}

// Fetch 7Timer! ASTRO data
async function fetch7Timer(lat, lon) {
    const response = await fetch(`https://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json`);
    return await response.json();
}

// Fetch OpenWeatherMap data
async function fetchOpenWeather(lat, lon) {
    const apiKey = '3e87f27f9ac9b7d9fb27c6034e561eb4';
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`);
    return await response.json();
}
