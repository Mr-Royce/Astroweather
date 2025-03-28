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
            fetchOpenWeatherForecast(lat, lon)
        ]);

        // Get sunset time from OpenWeatherMap’s current weather (approximation)
        const currentWeather = await fetchOpenWeather(lat, lon);
        const sunsetHour = new Date(currentWeather.sys.sunset * 1000).getHours();

        // Process 3-day forecast
        let forecastHTML = '';
        for (let day = 0; day < 3; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

            // 7Timer! data (8 points/day, ~3-hour intervals)
            const sevenTimerDay = sevenTimerData.dataseries.slice(day * 8, (day + 1) * 8);
            // OpenWeatherMap 3-hour forecast (8 points/day)
            const openWeatherDay = openWeatherData.list.slice(day * 8, (day + 1) * 8);

            let hourlyHTML = '';
            openWeatherDay.forEach((hour, i) => {
                const time = new Date(hour.dt * 1000);
                if (time.getHours() < sunsetHour && day === 0) return; // Skip pre-sunset on day 1

                const sevenTimerHour = sevenTimerDay[i] || sevenTimerDay[sevenTimerDay.length - 1];
                const cloudCover = (sevenTimerHour.cloudcover * 10 + hour.clouds.all) / 2;
                const temp = ((hour.main.temp - 273.15) * 9/5 + 32 + (sevenTimerHour.temp2m * 9/5 + 32)) / 2; // °F
                const windSpeed = ((hour.wind.speed + sevenTimerHour.wind10m.speed) * 2.237) / 2; // MPH
                const humidity = (hour.main.humidity + sevenTimerHour.rh2m) / 2;
                const seeing = sevenTimerHour.seeing;
                const transparency = mapTransparency(sevenTimerHour.transparency);

                hourlyHTML += `
                    <div class="hourly">
                        <strong>${time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}:</strong><br>
                        Cloud: ${cloudCover.toFixed(1)}%, Temp: ${temp.toFixed(1)}°F, Wind: ${windSpeed.toFixed(1)} MPH<br>
                        Humidity: ${humidity.toFixed(1)}%, Seeing: ${seeing}", Transparency: ${transparency}
                    </div>
                `;
            });

            forecastHTML += `
                <div class="day-card">
                    <h3>${dateStr}</h3>
                    ${hourlyHTML}
                </div>
            `;
        }

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

// Fetch OpenWeatherMap 3-hour 5-day forecast
async function fetchOpenWeatherForecast(lat, lon) {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
    if (!response.ok) throw new Error('OpenWeatherMap forecast fetch failed: ' + response.status);
    return await response.json();
}

// Fetch OpenWeatherMap current weather (for sunset time)
async function fetchOpenWeather(lat, lon) {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
    if (!response.ok) throw new Error('OpenWeatherMap current fetch failed');
    return await response.json();
}

// Map transparency
function mapTransparency(value) {
    const scale = { 1: 'Excellent', 2: 'Good', 3: 'Average', 4: 'Below Avg', 5: 'Poor', 6: 'Very Poor', 7: 'Terrible' };
    return scale[value] || 'Unknown';
}
