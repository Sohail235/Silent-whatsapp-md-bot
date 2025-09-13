// weather.js
const axios = require('axios');

async function getWeather(city) {
    try {
        // wttr.in JSON API
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
        const { data } = await axios.get(url);

        const current = data.current_condition[0];
        return {
            city,
            temp: current.temp_C,
            feels_like: current.FeelsLikeC,
            humidity: current.humidity,
            condition: current.weatherDesc[0].value,
            wind: current.windspeedKmph
        };
    } catch (err) {
        console.error('Weather Error:', err.message);
        return null;
    }
}

module.exports = { getWeather };
