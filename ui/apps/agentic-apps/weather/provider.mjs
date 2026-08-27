const GEOCODING_ORIGIN = "https://geocoding-api.open-meteo.com";
const FORECAST_ORIGIN = "https://api.open-meteo.com";
const AIR_QUALITY_ORIGIN = "https://air-quality-api.open-meteo.com";
const NWS_ORIGIN = "https://api.weather.gov";

export async function fetchWeatherDashboard(
  city,
  { fetchImpl = fetch, timeoutMs = 8_000 } = {},
) {
  const location = await resolveLocation(city, { fetchImpl, timeoutMs });
  const forecastUrl = new URL("/v1/forecast", FORECAST_ORIGIN);
  setLocation(forecastUrl, location);
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
  );
  forecastUrl.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
  );
  forecastUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
  );
  forecastUrl.searchParams.set("temperature_unit", "celsius");
  forecastUrl.searchParams.set("wind_speed_unit", "kmh");
  forecastUrl.searchParams.set("forecast_days", "7");
  forecastUrl.searchParams.set("timezone", "auto");

  const airQualityUrl = new URL("/v1/air-quality", AIR_QUALITY_ORIGIN);
  setLocation(airQualityUrl, location);
  airQualityUrl.searchParams.set("current", "us_aqi,pm2_5,ozone");
  airQualityUrl.searchParams.set("timezone", "auto");

  const [forecast, airQuality, nationalWeatherAlerts] = await Promise.all([
    fetchJson(forecastUrl, { fetchImpl, timeoutMs }),
    fetchAirQuality(airQualityUrl, { fetchImpl, timeoutMs }),
    fetchNationalWeatherAlerts(location, { fetchImpl, timeoutMs }),
  ]);

  return buildWeatherDashboard({ location, forecast, airQuality, nationalWeatherAlerts });
}

async function resolveLocation(city, options) {
  const normalized = String(city || "").trim();
  if (!normalized) throw new Error("A city is required");

  const url = new URL("/v1/search", GEOCODING_ORIGIN);
  url.searchParams.set("name", normalized);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const payload = await fetchJson(url, options);
  const match = Array.isArray(payload.results) ? payload.results[0] : null;
  if (!match || !Number.isFinite(Number(match.latitude)) || !Number.isFinite(Number(match.longitude))) {
    throw new Error(`No weather location matched "${normalized}"`);
  }
  return {
    name: String(match.name || normalized),
    region: String(match.admin1 || ""),
    country: String(match.country || ""),
    countryCode: String(match.country_code || "").toUpperCase(),
    latitude: Number(match.latitude),
    longitude: Number(match.longitude),
  };
}

async function fetchAirQuality(url, options) {
  try {
    const payload = await fetchJson(url, options);
    const current = payload.current || {};
    const usAqi = numberOrNull(current.us_aqi);
    return {
      available: usAqi !== null,
      usAqi,
      category: aqiCategory(usAqi),
      pm25: numberOrNull(current.pm2_5),
      ozone: numberOrNull(current.ozone),
      provider: "Open-Meteo Air Quality",
    };
  } catch (error) {
    return {
      available: false,
      reason: `Open-Meteo air quality unavailable: ${errorMessage(error)}`,
    };
  }
}

async function fetchNationalWeatherAlerts(location, options) {
  if (location.countryCode !== "US") {
    return {
      available: false,
      reason: "National Weather Service alerts are available for US locations only.",
      alerts: [],
    };
  }

  const url = new URL("/alerts/active", NWS_ORIGIN);
  url.searchParams.set("point", `${location.latitude},${location.longitude}`);
  try {
    const payload = await fetchJson(url, {
      ...options,
      headers: {
        accept: "application/geo+json",
        "user-agent": "CAIPE Weather Lab (weather-dashboard@example.com)",
      },
    });
    return {
      available: true,
      provider: "National Weather Service",
      alerts: (Array.isArray(payload.features) ? payload.features : []).slice(0, 5).map((feature) => ({
        event: String(feature?.properties?.event || "Weather alert"),
        severity: String(feature?.properties?.severity || "Unknown"),
        headline: String(feature?.properties?.headline || feature?.properties?.description || ""),
        instruction: String(feature?.properties?.instruction || ""),
      })),
    };
  } catch (error) {
    return {
      available: false,
      reason: `National Weather Service alerts unavailable: ${errorMessage(error)}`,
      alerts: [],
    };
  }
}

function buildWeatherDashboard({ location, forecast, airQuality, nationalWeatherAlerts }) {
  const current = forecast.current || {};
  const daily = zipDaily(forecast.daily || {});
  const hourly = zipHourly(forecast.hourly || {});
  const condition = weatherCodeDescription(current.weather_code);
  const risks = buildRiskSignals({ current, daily, airQuality, nationalWeatherAlerts });
  const bestWindow = findBestWindow(hourly);
  const temperatureC = numberOrNull(current.temperature_2m);

  return {
    source: "open-meteo-provider-fallback",
    providers: ["Open-Meteo Forecast", "Open-Meteo Air Quality", "National Weather Service"],
    city: location.name,
    region: location.region,
    country: location.country,
    observedAt: String(current.time || new Date().toISOString()),
    current: {
      temperatureC,
      apparentC: numberOrNull(current.apparent_temperature),
      humidity: numberOrNull(current.relative_humidity_2m),
      windKmh: numberOrNull(current.wind_speed_10m),
      code: numberOrNull(current.weather_code),
      condition,
    },
    daily,
    hourly,
    airQuality,
    nationalWeatherAlerts,
    dailyGuidance: {
      verdict: risks.length ? "Plan around today’s conditions" : "Conditions look favorable",
      howIsMyDay: `${location.name}: ${condition.toLowerCase()}${temperatureC === null ? "" : ` at ${Math.round(temperatureC)}°C`}.`,
      riskSignals: risks,
      ...(bestWindow ? { bestWindow } : {}),
    },
    recommendations: recommendationsFor({ risks, bestWindow }),
  };
}

function zipDaily(daily) {
  const times = array(daily.time);
  return times.map((date, index) => {
    const code = numberAt(daily.weather_code, index);
    return {
      date,
      label: weekday(date),
      highC: numberAt(daily.temperature_2m_max, index),
      lowC: numberAt(daily.temperature_2m_min, index),
      rainChance: numberAt(daily.precipitation_probability_max, index) ?? 0,
      windKmh: numberAt(daily.wind_speed_10m_max, index) ?? 0,
      code,
      condition: weatherCodeDescription(code),
    };
  });
}

function zipHourly(hourly) {
  return array(hourly.time).slice(0, 48).map((time, index) => ({
    time,
    label: hourLabel(time),
    tempC: numberAt(hourly.temperature_2m, index),
    rainChance: numberAt(hourly.precipitation_probability, index) ?? 0,
    windKmh: numberAt(hourly.wind_speed_10m, index) ?? 0,
    code: numberAt(hourly.weather_code, index),
  }));
}

function buildRiskSignals({ current, daily, airQuality, nationalWeatherAlerts }) {
  const risks = [];
  const today = daily[0] || {};
  if ((today.rainChance || 0) >= 60) risks.push(`${Math.round(today.rainChance)}% chance of precipitation`);
  if ((current.wind_speed_10m || 0) >= 40) risks.push(`Strong wind near ${Math.round(current.wind_speed_10m)} km/h`);
  if ((airQuality.usAqi || 0) >= 101) risks.push(`Air quality is ${airQuality.category || "unhealthy"}`);
  const alertCount = nationalWeatherAlerts.alerts?.length || 0;
  if (alertCount) risks.push(`${alertCount} active National Weather Service alert${alertCount === 1 ? "" : "s"}`);
  return risks;
}

function findBestWindow(hourly) {
  const candidate = hourly.slice(0, 24).find((point) =>
    point.tempC !== null && point.rainChance < 30 && point.windKmh < 25,
  );
  return candidate ? { label: candidate.label, time: candidate.time } : null;
}

function recommendationsFor({ risks, bestWindow }) {
  const recommendations = [];
  if (bestWindow) recommendations.push(`The lowest-risk near-term outdoor window begins around ${bestWindow.label}.`);
  if (risks.length) recommendations.push(`Review these signals before outdoor plans: ${risks.join("; ")}.`);
  if (!recommendations.length) recommendations.push("No material weather, air-quality, or alert risks are visible right now.");
  return recommendations;
}

async function fetchJson(url, { fetchImpl, timeoutMs, headers = {} }) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url.hostname} returned HTTP ${response.status}`);
  return response.json();
}

function setLocation(url, location) {
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
}

function weatherCodeDescription(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2].includes(code)) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Mixed conditions";
}

function aqiCategory(value) {
  if (value === null) return "Unavailable";
  if (value <= 50) return "Good";
  if (value <= 100) return "Moderate";
  if (value <= 150) return "Unhealthy for sensitive groups";
  if (value <= 200) return "Unhealthy";
  if (value <= 300) return "Very unhealthy";
  return "Hazardous";
}

function weekday(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
}

function hourLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(date);
}

function numberAt(values, index) {
  return numberOrNull(array(values)[index]);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "provider request failed";
}
