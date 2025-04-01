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

// Attach event listener if input exists
const locationInput = document.getElementById('location');
if (locationInput) {
    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') getForecast();
    });
}

// Run forecast on page load with default location
window.onload = () => getForecast();

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
            const locationValue = locationInput ? locationInput.value : '10001';
            if (locationValue.includes(',')) {
                [lat, lon] = locationValue.split(',').map(Number);
                const reverseGeo = await fetch(`https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${OPENWEATHER_API_KEY}`)
                    .then(res => res.json());
                locationName = reverseGeo[0]?.name || `Lat: ${lat}, Lon: ${lon}`;
            } else if (/^\d{5}$/.test(locationValue)) {
                ({ lat, lon, name: locationName } = await geocodeZip(locationValue));
            } else {
                ({ lat, lon, name: locationName } = await geocodeCity(locationValue));
            }
        }

        const [currentWeather, sevenTimerData, openWeatherData, twilightData, meteosourceData] = await Promise.all([
            fetchOpenWeather(lat, lon),
            fetch7Timer(lat, lon),
            fetchOpenWeatherForecast(lat, lon),
            fetchSunriseSunset(lat, lon),
            fetchMeteosource(lat, lon).catch(err => { console.warn('Meteosource failed:', err); return null; })
        ]);

        const sunsetHour = new Date(currentWeather.sys.sunset * 1000).getHours();
        const currentTime = new Date();

        let forecastHTML = '';
        for (let day = 0; day < 3; day++) {
            const date = new Date();
            date.setDate(date.getDate() + day);
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

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
            console.log(`Day ${day} Moon Phase: ${moonPhase} (Phase: ${calculateMoonPhaseRaw(date).toFixed(4)})`);
            const moonIcon = getMoonPhaseIcon(moonPhase);

            const sevenTimerDay = sevenTimerData.dataseries.slice(day * 8, Math.min((day + 1) * 8, sevenTimerData.dataseries.length));
            const openWeatherDay = openWeatherData.list.slice(day * 8, Math.min((day + 1) * 8, openWeatherData.list.length));
            const meteosourceDay = meteosourceData?.hourly?.data?.slice(day * 24, Math.min((day + 1) * 24, meteosourceData?.hourly?.data?.length)) || [];

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

            let hourlyHTML = '';
            openWeatherDay.forEach((hour, i) => {
                const time = new Date(hour.dt * 1000);
                if (day === 0 && time < currentTime) return;

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
                    <button class="expand-btn" onclick="toggleForecast(this)">Expand</button>
                    <div class="hourly-forecast">${hourlyHTML}</div>
                </div>
            `;
        }

        document.getElementById('forecast').innerHTML = `<h2>${locationName}</h2>${forecastHTML}`;
    } catch (error) {
        console.error('Error fetching forecast:', error);
        document.getElementById('forecast').innerHTML = `<h2>Error</h2><p>${error.message === 'Geolocation failed' ? 'Location access denied. Please enter manually.' : 'Could not fetch forecast.'}</p>`;
    }
}

// Toggle function for hourly forecast
function toggleForecast(button) {
    const hourlyDiv = button.nextElementSibling;
    hourly
