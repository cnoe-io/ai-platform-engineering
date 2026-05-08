"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useState } from "react";

import { AgenticAppAssistantPanel } from "@/components/agentic-apps/AgenticAppAssistantPanel";

type WeatherSurface =
  | {
      type: "weather.current";
      props: {
        city: string;
        temperature: string;
        condition: string;
        wind: string;
        airQuality: string;
      };
    }
  | {
      type: "weather.forecast";
      props: {
        forecast: Array<{
          day: string;
          high: string;
          low: string;
          condition: string;
        }>;
      };
    }
  | {
      type: "weather.recommendations";
      props: {
        recommendations: string[];
      };
    };

const DEFAULT_CITY = "San Jose, CA";

const DEFAULT_SURFACES: WeatherSurface[] = [
  {
    type: "weather.current",
    props: {
      city: DEFAULT_CITY,
      temperature: "72°F",
      condition: "Clear",
      wind: "7 mph NW",
      airQuality: "Good",
    },
  },
  {
    type: "weather.forecast",
    props: {
      forecast: [
        { day: "Today", high: "74°F", low: "56°F", condition: "Clear" },
        { day: "Tomorrow", high: "69°F", low: "54°F", condition: "Clouds building" },
        { day: "Saturday", high: "66°F", low: "51°F", condition: "Light rain" },
      ],
    },
  },
  {
    type: "weather.recommendations",
    props: {
      recommendations: [
        "Good window for outdoor standups before 3 PM.",
        "Pack a light jacket for the evening temperature drop.",
        "Rain-sensitive deploy windows should avoid Saturday morning travel.",
      ],
    },
  },
];

export function WeatherIntegratedApp() {
  const [city, setCity] = useState(DEFAULT_CITY);
  const [surfaces, setSurfaces] = useState<WeatherSurface[]>(DEFAULT_SURFACES);
  const [status, setStatus] = useState("Ready");

  async function askWeatherAdvisor() {
    setStatus("Loading AG-UI layout...");
    try {
      const res = await fetch(
        `/apps/weather/api/ag-ui/weather-layout?city=${encodeURIComponent(city)}`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) {
        throw new Error("weather_layout_unavailable");
      }
      const envelope = await res.json() as { surfaces?: WeatherSurface[] };
      setSurfaces(Array.isArray(envelope.surfaces) ? envelope.surfaces : DEFAULT_SURFACES);
      setStatus("Rendered from Weather Advisor AG-UI response");
    } catch {
      setStatus("Weather Advisor unavailable; showing template fallback");
      setSurfaces(DEFAULT_SURFACES);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-3xl border border-cyan-300/20 bg-white/[0.04] p-7 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Integrated app surface
          </p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white">
                Weather Starter
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                CAIPE shell remains in control of navigation, session, RBAC, audit,
                and launch policy. The Weather app provides typed AG-UI surfaces
                that this native viewport renders with CAIPE styling.
              </p>
            </div>
            <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-200">
              {status}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-slate-300">
              City
              <input
                className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-300/60"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </label>
            <button
              className="self-end rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
              type="button"
              onClick={askWeatherAdvisor}
            >
              Ask Weather Advisor
            </button>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
          <div className="relative overflow-hidden rounded-3xl border border-sky-300/20 bg-gradient-to-br from-sky-500/15 via-cyan-400/10 to-slate-900 p-6 shadow-2xl shadow-cyan-950/30">
            <div className="absolute right-8 top-8 h-28 w-28 rounded-full bg-amber-200/80 blur-sm" />
            <div className="absolute bottom-6 left-12 h-20 w-56 rounded-full bg-cyan-200/20 blur-2xl" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100">
                Weather radar
              </p>
              <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-white">
                Agent-rendered weather surfaces with CAIPE-owned controls
              </h2>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {["AG-UI event stream", "CopilotKit action", "Fragment fallback"].map((label) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm font-semibold text-slate-100 backdrop-blur"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <AgenticAppAssistantPanel
            appName="Weather Starter"
            agentName="weather-advisor"
            prompt="Explain the weather-sensitive deployment windows for this city."
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
            <h2 className="text-xl font-semibold text-white">Current conditions</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {surfaces.map((surface) => (
                <WeatherSurfaceCard key={surface.type} surface={surface} />
              ))}
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">CopilotKit boundary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The template maps a CopilotKit-style frontend action to known weather
              components. Agents can choose layouts and props, but they do not send
              arbitrary HTML into the CAIPE shell.
            </p>
            <pre className="mt-5 overflow-auto rounded-2xl border border-cyan-300/20 bg-slate-950/80 p-4 text-xs leading-5 text-cyan-100">
{`useCopilotAction({
  name: "renderWeatherLayout",
  render: ({ args }) => <WeatherLayout city={args.city} />,
});`}
            </pre>
            <a
              className="mt-5 inline-flex text-sm font-semibold text-cyan-200 hover:text-cyan-100"
              href="/apps/weather/embed"
            >
              View fragment endpoint
            </a>
          </aside>
        </section>
      </div>
    </main>
  );
}

function WeatherSurfaceCard({ surface }: { surface: WeatherSurface }) {
  if (surface.type === "weather.current") {
    return (
      <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <p className="text-sm text-slate-400">Current in {surface.props.city}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-white">
          {surface.props.temperature}
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <Metric label="Condition" value={surface.props.condition} />
          <Metric label="Wind" value={surface.props.wind} />
          <Metric label="Air quality" value={surface.props.airQuality} />
        </dl>
      </article>
    );
  }

  if (surface.type === "weather.forecast") {
    return (
      <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <h3 className="font-semibold text-white">Forecast timeline</h3>
        <ul className="mt-4 space-y-3 text-sm text-slate-300">
          {surface.props.forecast.map((day) => (
            <li key={day.day} className="rounded-xl bg-white/[0.04] p-3">
              <span className="font-semibold text-white">{day.day}</span>: {day.condition} ·{" "}
              {day.high} / {day.low}
            </li>
          ))}
        </ul>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-5 md:col-span-2">
      <h3 className="font-semibold text-white">Advisor recommendations</h3>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
        {surface.props.recommendations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-100">{value}</dd>
    </div>
  );
}
