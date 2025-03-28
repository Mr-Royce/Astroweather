const API_KEY = '3e87f27f9ac9b7d9fb27c6034e561eb4';

document.getElementById('location').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') getForecast();
});

async function getForecast(useGeolocation = false) {
    let lat, lon, locationName;

    try {
        if (useGeolocation) {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject);
            });
            lat = position.coords.latitude;
            lon = position.coords.longitude;
            locationName = `Current Location (Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)})`;
        } else {
            const locationInput = document.getElementById('location').value || '10001';
            if (locationInput.includes(',')) {
                [lat, lon] = locationInput.split(',').map(Number);
                locationName = `Lat: ${lat}, Lon: ${lon}`;
            } else if (/^\d{5}$/.test(locationInput)) {
                ({ lat, lon, name: locationName } = await geocodeZip(locationInput));
            } else {
                ({ lat, lon, name: locationName } = await geocodeCity(locationInput));
            }
        }

        // Fetch current weather for sunset time (used as a base)
        const currentWeather = await fetchOpenWeather(lat, lon);
        const sunsetHour = new Date(currentWeather.sys.sunset * 1000).getHours();

        // Fetch forecast data
        const [sevenTimerData, openWeatherData] = await Promise.all([
            fetch7Timer(lat, lon),
            fetchOpenWeatherForecast(lat, lon)
        ]);

        // Process 3-day forecast
        let forecastHTML = '';
        for (let day = 0; day < 3; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

            // Calculate astronomical twilight for this specific day
            const astroTwilightTime = calculateAstroTwilight(lat, lon, date, currentWeather.sys.sunset * 1000 + day * 24 * 60 * 60 * 1000);

            const sevenTimerDay = sevenTimerData.dataseries.slice(day * 8, (day + 1) * 8);
            const openWeatherDay = openWeatherData.list.slice(day * 8, (day + 1) * 8);

            // Daily summary
            const temps = openWeatherDay.map(hour => (hour.main.temp - 273.15) * 9/5 + 32)
                .concat(sevenTimerDay.map(hour => hour.temp2m * 9/5 + 32));
            const highTemp = Math.max(...temps);
            const lowTemp = Math.min(...temps);

            const eveningHours = openWeatherDay.filter(hour => {
                const time = new Date(hour.dt * 1000).getHours();
                return time >= 20 && time <= 23;
            });
            const eveningClouds = eveningHours.map((hour, i) => 
                (hour.clouds.all + (sevenTimerDay[i + 6]?.cloudcover || sevenTimerDay[7].cloudcover) * 10) / 2
            );
            const avgEveningCloudCover = eveningClouds.length ? eveningClouds.reduce((a, b) => a + b, 0) / eveningClouds.length : 0;

            // Hourly forecast
            let hourlyHTML = '';
            openWeatherDay.forEach((hour, i) => {
                const time = new Date(hour.dt * 1000);
                if (time.getHours() < sunsetHour && day === 0) return;

                const sevenTimerHour = sevenTimerDay[i] || sevenTimerDay[sevenTimerDay.length - 1];
                const cloudCover = (sevenTimerHour.cloudcover * 10 + hour.clouds.all) / 2;
                const temp = ((hour.main.temp - 273.15) * 9/5 + 32 + (sevenTimerHour.temp2m * 9/5 + 32)) / 2;
                const windSpeed = ((hour.wind.speed + sevenTimerHour.wind10m.speed) * 2.237) / 2;
                const humidity = (hour.main.humidity + sevenTimerHour.rh2m) / 2;
                const seeing = mapSeeing(sevenTimerHour.seeing);
                const transparency = cloudCover > 80 ? 'Cloudy' : mapTransparency(sevenTimerHour.transparency);

                hourlyHTML += `
                    <div class="hourly">
                        <strong>${time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}:</strong><br>
                        Cloud: ${cloudCover.toFixed(1)}%, Temp: ${temp.toFixed(1)}°F, Wind: ${windSpeed.toFixed(1)} MPH<br>
                        Humidity: ${humidity.toFixed(1)}%, Seeing: ${seeing}, Transparency: ${transparency}
                    </div>
                `;
            });

            forecastHTML += `
                <div class="day-card">
                    <h3>${dateStr}</h3>
                    <div class="day-summary">
                        High: ${highTemp.toFixed(1)}°F, Low: ${lowTemp.toFixed(1)}°F<br>
                        Avg Cloud Cover (8 PM - 12 AM): ${avgEveningCloudCover.toFixed(1)}%<br>
                        <strong>Astro Twilight:</strong> ${
                            astroTwilightTime instanceof Date && !isNaN(astroTwilightTime) 
                                ? astroTwilightTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) 
                                : 'Not available'
                        }
                    </div>
                    ${hourlyHTML}
                </div>
            `;
        }

        document.getElementById('forecast').innerHTML = `<h2>${locationName}</h2>${forecastHTML}`;
    } catch (error) {
        console.error('Error fetching forecast:', error);
        document.getElementById('forecast').innerHTML = `<h2>Error</h2><p>${error.message === 'Geolocation failed' ? 'Location access denied. Please enter manually.' : 'Could not fetch forecast.'}</p>`;
    }
}

// Fetch functions
function geocodeCity(city) {
    return fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('Geocoding failed'); return res.json(); })
        .then(data => ({ lat: data[0].lat, lon: data[0].lon, name: data[0].name }));
}

function geocodeZip(zip) {
    return fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${zip},US&appid=${API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('Zip code geocoding failed'); return res.json(); })
        .then(data => ({ lat: data.lat, lon: data.lon, name: data.name }));
}

function fetch7Timer(lat, lon) {
    return fetch(`https://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json`)
        .then(res => { if (!res.ok) throw new Error('7Timer! fetch failed'); return res.json(); });
}

function fetchOpenWeatherForecast(lat, lon) {
    return fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('OpenWeatherMap forecast fetch failed'); return res.json(); });
}

function fetchOpenWeather(lat, lon) {
    return fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('OpenWeatherMap current fetch failed'); return res.json(); });
}

// Calculate astronomical twilight
function calculateAstroTwilight(lat, lon, date, sunsetTime) {
    const J0 = 2451545.0; // J2000 epoch
    const n = Math.floor((date - new Date('2000-01-01T12:00:00Z')) / (1000 * 60 * 60 * 24)); // Days since J2000
    const L = 280.460 + 0.9856474 * n; // Mean longitude
    const g = 357.528 + 0.9856003 * n; // Mean anomaly
    const lambda = (L + 1.915 * Math.sin(g * Math.PI / 180) + 0.020 * Math.sin(2 * g * Math.PI / 180)) % 360; // Ecliptic longitude
    const epsilon = 23.439 - 0.0000004 * n; // Obliquity
    const delta = Math.asin(Math.sin(epsilon * Math.PI / 180) * Math.sin(lambda * Math.PI / 180)) * 180 / Math.PI; // Declination

    const H0 = -18; // Astronomical twilight angle
    const cosH = (Math.cos(H0 * Math.PI / 180) - Math.sin(lat * Math.PI / 180) * Math.sin(delta * Math.PI / 180)) / 
                  (Math.cos(lat * Math.PI / 180) * Math.cos(delta * Math.PI / 180));
    
    if (cosH < -1 || cosH > 1 || isNaN(cosH)) {
        return new Date(sunsetTime + 90 * 60 * 1000); // Fallback: 90 minutes after sunset
    }

    const H = Math.acos(cosH) * 180 / Math.PI; // Hour angle
    const twilightMinutes = (H / 15) * 60; // Convert hour angle to minutes
    return new Date(sunsetTime + twilightMinutes * 60 * 1000);
}

function mapSeeing(value) {
    if (value < 1) return 'Excellent';
    if (value <= 2) return 'Good';
    if (value <= 3) return 'Average';
    if (value <= 5) return 'Poor';
    return 'Very Poor';
}

function mapTransparency(value) {
    const scale = { 1: 'Excellent', 2: 'Good', 3: 'Average', 4: 'Below Avg', 5: 'Poor', 6: 'Very Poor', 7: 'Terrible' };
    return scale[value] || 'Unknown';
}
