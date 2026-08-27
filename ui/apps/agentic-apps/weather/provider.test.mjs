import assert from "node:assert/strict";
import test from "node:test";

import { fetchWeatherDashboard } from "./provider.mjs";

const geocoding = {
  results: [
    {
      name: "Example City",
      admin1: "Primary Region",
      country: "Example Country",
      country_code: "US",
      latitude: 40,
      longitude: -100,
    },
  ],
};

const forecast = {
  current: {
    time: "2026-08-25T12:00",
    temperature_2m: 20,
    relative_humidity_2m: 50,
    apparent_temperature: 19,
    weather_code: 1,
    wind_speed_10m: 12,
  },
  hourly: {
    time: ["2026-08-25T12:00", "2026-08-25T13:00"],
    temperature_2m: [20, 21],
    precipitation_probability: [10, 20],
    weather_code: [1, 2],
    wind_speed_10m: [12, 14],
  },
  daily: {
    time: ["2026-08-25", "2026-08-26"],
    weather_code: [1, 61],
    temperature_2m_max: [24, 22],
    temperature_2m_min: [14, 13],
    precipitation_probability_max: [10, 70],
    wind_speed_10m_max: [18, 25],
  },
};

test("builds a live dashboard from forecast, air quality, and alert providers", async () => {
  const requestedHosts = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requestedHosts.push(url.hostname);
    if (url.hostname === "geocoding-api.open-meteo.com") return jsonResponse(geocoding);
    if (url.hostname === "api.open-meteo.com") return jsonResponse(forecast);
    if (url.hostname === "air-quality-api.open-meteo.com") {
      return jsonResponse({ current: { us_aqi: 34, pm2_5: 5.5, ozone: 48 } });
    }
    if (url.hostname === "api.weather.gov") return jsonResponse({ features: [] });
    throw new Error(`Unexpected provider: ${url.hostname}`);
  };

  const dashboard = await fetchWeatherDashboard("Example City", { fetchImpl });

  assert.deepEqual(requestedHosts.sort(), [
    "air-quality-api.open-meteo.com",
    "api.open-meteo.com",
    "api.weather.gov",
    "geocoding-api.open-meteo.com",
  ]);
  assert.equal(dashboard.source, "open-meteo-provider-fallback");
  assert.equal(dashboard.city, "Example City");
  assert.equal(dashboard.current.condition, "Partly cloudy");
  assert.equal(dashboard.daily.length, 2);
  assert.equal(dashboard.hourly.length, 2);
  assert.equal(dashboard.airQuality.category, "Good");
  assert.equal(dashboard.nationalWeatherAlerts.available, true);
  assert.match(dashboard.dailyGuidance.howIsMyDay, /Example City/);
});

test("keeps the forecast usable when optional providers fail", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "geocoding-api.open-meteo.com") return jsonResponse(geocoding);
    if (url.hostname === "api.open-meteo.com") return jsonResponse(forecast);
    return jsonResponse({ error: "unavailable" }, 503);
  };

  const dashboard = await fetchWeatherDashboard("Example City", { fetchImpl });

  assert.equal(dashboard.current.temperatureC, 20);
  assert.equal(dashboard.airQuality.available, false);
  assert.match(dashboard.airQuality.reason, /HTTP 503/);
  assert.equal(dashboard.nationalWeatherAlerts.available, false);
  assert.match(dashboard.nationalWeatherAlerts.reason, /HTTP 503/);
});

test("rejects an unknown location before calling forecast providers", async () => {
  const fetchImpl = async () => jsonResponse({ results: [] });

  await assert.rejects(
    () => fetchWeatherDashboard("Missing Place", { fetchImpl }),
    /No weather location matched/,
  );
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
