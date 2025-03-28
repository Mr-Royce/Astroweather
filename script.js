const OPENWEATHER_API_KEY = '3e87f27f9ac9b7d9fb27c6034e561eb4';
const METEOSOURCE_API_KEY = '1c42o0y7eq4oy8vcjylneurl68woiavvkgkbg3j4';

// Simplified moonrise/moonset calculator
function getMoonTimes(date, lat, lon) {
    const J2000 = 2451545.0;
    const daysSinceJ2000 = (date.getTime() / 86400000) - (new Date('2000-01-01T12:00:00Z').getTime() / 86400000);
    const lunarCycle = 29.53058867;
    const phaseAngle = (daysSinceJ2000 % lunarCycle) / lunarCycle * 360;

    const lw = -lon * Math.PI / 180;
    const phi = lat * Math.PI / 180;
    const H = Math.acos(-Math.tan(phi) * Math.tan(0.074 * Math.cos(phaseAngle * Math.PI / 180)));
    const rise = 12 - H * 12 / Math.PI + lw * 12 / Math.PI;
    const set = 12 + H * 12 / Math.PI + lw * 12 / Math.PI;

    const baseDate = new Date(date);
    baseDate.setUTCHours(0, 0, 0, 0);
    const moonrise = new Date(baseDate.getTime() + rise * 3600000);
    const moonset = new Date(baseDate.getTime() + set * 3600000);

    return { moonrise, moonset };
}

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
            const reverseGeo = await fetch(`https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${OPENWEATHER_API_KEY}`)
                .then(res => res.json());
            locationName = reverseGeo[0]?.name || `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
        } else {
            const locationInput = document.getElementById('location').value || '10001';
            if (locationInput.includes(',')) {
                [lat, lon] = locationInput.split(',').map(Number);
                const reverseGeo = await fetch(`https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${OPENWEATHER_API_KEY}`)
                    .then(res => res.json());
                locationName = reverseGeo[0]?.name || `Lat: ${lat}, Lon: ${lon}`;
            } else if (/^\d{5}$/.test(locationInput)) {
                ({ lat, lon, name: locationName } = await geocodeZip(locationInput));
            } else {
                ({ lat, lon, name: locationName } = await geocodeCity(locationInput));
            }
        }

        // Fetch all data
        const [currentWeather, sevenTimerData, openWeatherData, twilightData, meteosourceData] = await Promise.all([
            fetchOpenWeather(lat, lon),
            fetch7Timer(lat, lon),
            fetchOpenWeatherForecast(lat, lon),
            fetchSunriseSunset(lat, lon),
            fetchMeteosource(lat, lon).catch(err => { console.warn('Meteosource failed:', err); return null; })
        ]);

        const sunsetHour = new Date(currentWeather.sys.sunset * 1000).getHours();

        // Process 3-day forecast
        let forecastHTML = '';
        for (let day = 0; day < 3; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

            // Astro twilight, moonrise, moonset, and moon phase
            const astroTwilightTime = twilightData[day]?.results?.astronomical_twilight_end 
                ? new Date(twilightData[day].results.astronomical_twilight_end) 
                : null;
            let moonriseTime = twilightData[day]?.results?.moonrise && twilightData[day].results.moonrise !== 'N/A'
                ? new Date(twilightData[day].results.moonrise) 
                : null;
            let moonsetTime = twilightData[day]?.results?.moonset && twilightData[day].results.moonset !== 'N/A'
                ? new Date(twilightData[day].results.moonset) 
                : null;
            
            if (!moonriseTime || !moonsetTime) {
                const { moonrise, moonset } = getMoonTimes(date, lat, lon);
                moonriseTime = moonriseTime || moonrise;
                moonsetTime = moonsetTime || moonset;
            }

            const moonPhase = meteosourceData?.daily?.data[day]?.moon_phase || calculateMoonPhase(date);
            console.log(`Day ${day} Moon Phase: ${moonPhase}`); // Debug log
            const moonIcon = getMoonPhaseIcon(moonPhase);

            const sevenTimerDay = sevenTimerData.dataseries.slice(day * 8, Math.min((day + 1) * 8, sevenTimerData.dataseries.length));
            const openWeatherDay = openWeatherData.list.slice(day * 8, Math.min((day + 1) * 8, openWeatherData.list.length));
            const meteosourceDay = meteosourceData?.hourly?.data?.slice(day * 24, Math.min((day + 1) * 24, meteosourceData?.hourly?.data?.length)) || [];

            // Hourly averages for the day
            const hourlyTemps = openWeatherDay.map((hour, i) => {
                const sevenTimerHour = sevenTimerDay[i] || sevenTimerDay[sevenTimerDay.length - 1];
                const msHour = meteosourceDay[i * 3] || meteosourceDay[meteosourceDay.length - 1] || {};
                return [(hour.main.temp - 273.15) * 9/5 + 32, sevenTimerHour.temp2m * 9/5 + 32, msHour.temperature * 9/5 + 32]
                    .filter(t => !isNaN(t)).reduce((a, b) => a + b, 0) / (msHour.temperature ? 3 : 2);
            }).filter(t => !isNaN(t));
            const highTemp = hourlyTemps.length ? Math.max(...hourlyTemps) : NaN;
            const lowTemp = hourlyTemps.length ? Math.min(...hourlyTemps) : NaN;

            const eveningHours = openWeatherDay.filter(hour => {
                const time = new Date(hour.dt * 1000).getHours();
                return time >= 20 && time <= 23;
            });
            const eveningClouds = eveningHours.map((hour, i) => {
                const msHour = meteosourceDay.find(h => h && new Date(h.date).getHours() === new Date(hour.dt * 1000).getHours()) || meteosourceDay[Math.min(20 + i, meteosourceDay.length - 1)] || {};
                const clouds = [
                    hour.clouds.all,
                    (sevenTimerDay[i + 6]?.cloudcover || sevenTimerDay[sevenTimerDay.length - 1].cloudcover) * 10,
                    msHour.cloud_cover?.total || 0
                ].filter(c => c !== undefined);
                return clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : 0;
            });
            const avgEveningCloudCover = eveningClouds.length ? eveningClouds.reduce((a, b) => a + b, 0) / eveningClouds.length : 0;

            // Hourly forecast
            let hourlyHTML = '';
            openWeatherDay.forEach((hour, i) => {
                const time = new Date(hour.dt * 1000);
                if (time.getHours() < sunsetHour && day === 0) return;

                const sevenTimerHour = sevenTimerDay[i] || sevenTimerDay[sevenTimerDay.length - 1];
                const msHour = meteosourceDay[i * 3] || meteosourceDay[meteosourceDay.length - 1] || {};

                const cloudCover = [hour.clouds.all, sevenTimerHour.cloudcover * 10, msHour.cloud_cover?.total || 0]
                    .filter(c => c !== undefined).reduce((a, b) => a + b, 0) / (msHour.cloud_cover ? 3 : 2);
                const temp = [(hour.main.temp - 273.15) * 9/5 + 32, sevenTimerHour.temp2m * 9/5 + 32, msHour.temperature * 9/5 + 32]
                    .filter(t => !isNaN(t)).reduce((a, b) => a + b, 0) / (msHour.temperature ? 3 : 2);
                const windSpeed = [hour.wind.speed, sevenTimerHour.wind10m.speed, msHour.wind?.speed || 0]
                    .filter(w => w !== undefined).reduce((a, b) => a + b, 0) * 2.237 / (msHour.wind ? 3 : 2);
                const humidity = [hour.main.humidity, sevenTimerHour.rh2m, msHour.relative_humidity || 0]
                    .filter(h => h !== undefined).reduce((a, b) => a + b, 0) / (msHour.relative_humidity ? 3 : 2);
                const precipChance = msHour.precipitation?.total ? msHour.precipitation.total * 100 / 25.4 : 0;
                const seeing = mapSeeing(sevenTimerHour.seeing);
                const transparency = cloudCover > 80 ? 'Cloudy' : mapTransparency(sevenTimerHour.transparency);

                const cloudClass = cloudCover < 30 ? 'cloud-good' : cloudCover <= 70 ? 'cloud-avg' : 'cloud-poor';
                const seeingClass = ['Excellent', 'Good'].includes(seeing) ? 'seeing-good' : seeing === 'Average' ? 'seeing-avg' : 'seeing-poor';
                const transClass = ['Excellent', 'Good'].includes(transparency) ? 'trans-good' : ['Average', 'Below Avg'].includes(transparency) ? 'trans-avg' : 'trans-poor';
                const precipClass = precipChance < 10 ? 'precip-low' : precipChance <= 50 ? 'precip-mid' : 'precip-high';

                hourlyHTML += `
                    <div class="hourly">
                        <strong>${time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}:</strong><br>
                        <span class="${cloudClass}">Cloud: ${cloudCover.toFixed(1)}%</span>, Temp: ${temp.toFixed(1)}°F, Wind: ${windSpeed.toFixed(1)} MPH<br>
                        Humidity: ${humidity.toFixed(1)}%, <span class="${precipClass}">Precip: ${precipChance.toFixed(1)}%</span><br>
                        <span class="${seeingClass}">Seeing: ${seeing}</span>, <span class="${transClass}">Transparency: ${transparency}</span>
                    </div>
                `;
            });

            forecastHTML += `
                <div class="day-card">
                    <h3>${dateStr}</h3>
                    <div class="day-summary">
                        High: ${isNaN(highTemp) ? 'N/A' : highTemp.toFixed(1)}°F, Low: ${isNaN(lowTemp) ? 'N/A' : lowTemp.toFixed(1)}°F<br>
                        Avg Cloud Cover (8 PM - 12 AM): ${avgEveningCloudCover.toFixed(1)}%<br>
                        <strong>Astro Twilight:</strong> ${
                            astroTwilightTime instanceof Date && !isNaN(astroTwilightTime) 
                                ? astroTwilightTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) 
                                : 'Not available'
                        }<br>
                        <strong>Moon Phase:</strong> ${moonIcon} ${moonPhase}<br>
                        <strong>Moonrise:</strong> ${
                            moonriseTime instanceof Date && !isNaN(moonriseTime) 
                                ? moonriseTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) 
                                : 'Not available'
                        }<br>
                        <strong>Moonset:</strong> ${
                            moonsetTime instanceof Date && !isNaN(moonsetTime) 
                                ? moonsetTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) 
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
    return fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${OPENWEATHER_API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('Geocoding failed'); return res.json(); })
        .then(data => ({ lat: data[0].lat, lon: data[0].lon, name: data[0].name }));
}

function geocodeZip(zip) {
    return fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${zip},US&appid=${OPENWEATHER_API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('Zip code geocoding failed'); return res.json(); })
        .then(data => ({ lat: data.lat, lon: data.lon, name: data.name }));
}

function fetch7Timer(lat, lon) {
    return fetch(`https://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json`)
        .then(res => { if (!res.ok) throw new Error('7Timer! fetch failed'); return res.json(); });
}

function fetchOpenWeatherForecast(lat, lon) {
    return fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('OpenWeatherMap forecast fetch failed'); return res.json(); });
}

function fetchOpenWeather(lat, lon) {
    return fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('OpenWeatherMap current fetch failed'); return res.json(); });
}

function fetchSunriseSunset(lat, lon) {
    const today = new Date();
    const dates = [0, 1, 2].map(day => {
        const d = new Date(today);
        d.setDate(today.getDate() + day);
        return d.toISOString().split('T')[0];
    });
    return Promise.all(dates.map(date => 
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${date}&formatted=0`)
            .then(res => res.json())
    ));
}

function fetchMeteosource(lat, lon) {
    return fetch(`https://www.meteosource.com/api/v1/free/point?lat=${lat}&lon=${lon}&sections=current,hourly,daily&units=metric&key=${METEOSOURCE_API_KEY}`)
        .then(res => { if (!res.ok) throw new Error('Meteosource fetch failed'); return res.json(); });
}

// Moon phase calculator
function calculateMoonPhase(date) {
    const J2000 = 2451545.0;
    const daysSinceJ2000 = (date.getTime() / 86400000) - (new Date('2000-01-01T12:00:00Z').getTime() / 86400000);
    const lunarCycle = 29.53058867;
    const phase = (daysSinceJ2000 % lunarCycle) / lunarCycle;

    if (phase < 0.03 || phase >= 0.97) return 'New Moon';
    if (phase < 0.25) return 'Waxing Crescent';
    if (phase < 0.47) return 'First Quarter';
    if (phase < 0.53) return 'Waxing Gibbous';
    if (phase < 0.75) return 'Full Moon';
    if (phase < 0.97) return 'Waning Gibbous';
    return 'Last Quarter';
}

// Moon phase icons (darker, 24x24)
function getMoonPhaseIcon(phase) {
    const size = 'width="24" height="24"';
    switch (phase) {
        case 'New Moon':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/></svg>`;
        case 'Waxing Crescent':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2a10 10 0 0 0 0 20c-2.5 0-4.5-2-4.5-5s2-5 4.5-5z" fill="#999"/></svg>`;
        case 'First Quarter':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2v20a10 10 0 0 0 0-20z" fill="#999"/></svg>`;
        case 'Waxing Gibbous':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2a10 10 0 0 1 0 20c2.5 0 4.5-2 4.5-5s-2-5-4.5-5z" fill="#999"/></svg>`;
        case 'Full Moon':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#999" stroke="#000" stroke-width="1"/></svg>`;
        case 'Waning Gibbous':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2a10 10 0 0 0 0 20c-2.5 0-4.5-2-4.5-5s2-5 4.5-5z" fill="#999"/></svg>`;
        case 'Last Quarter':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2v20a10 10 0 0 1 0-20z" fill="#999"/></svg>`;
        case 'Waning Crescent':
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#333" stroke="#000" stroke-width="1"/><path d="M12 2a10 10 0 0 1 0 20c2.5 0 4.5-2 4.5-5s-2-5-4.5-5z" fill="#999"/></svg>`;
        default:
            return `<svg ${size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#666" stroke="#000" stroke-width="1"/></svg>`;
    }
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
