import { buildRubricRadarScores } from "@/lib/tome/rubric-radar";
import type { RubricResult } from "@/types/tome-evaluation";
import { InfoTooltip } from "@/components/tome/admin/RubricInfo";

export interface RubricRadarSeries {
  label: string;
  rubrics: RubricResult[];
}

interface RubricRadarChartProps {
  series: RubricRadarSeries[];
  emptyReason?: string;
}

const WIDTH = 680;
const HEIGHT = 470;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 225;
const RADIUS = 150;
const LABEL_RADIUS = 198;
const GRID_LEVELS = [0.2, 0.4, 0.6, 0.8, 1];

function coordinates(index: number, count: number, radius: number): [number, number] {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [CENTER_X + Math.cos(angle) * radius, CENTER_Y + Math.sin(angle) * radius];
}

function polygonPoints(values: number[]): string {
  return values
    .map((value, index) => coordinates(index, values.length, RADIUS * value).join(","))
    .join(" ");
}

function mean(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function RubricRadarChart({ series, emptyReason }: RubricRadarChartProps) {
  const prepared = series.slice(0, 2).map((item) => ({
    ...item,
    dimensions: buildRubricRadarScores(item.rubrics),
  }));
  const dimensions = prepared[0]?.dimensions
    .filter((dimension) => prepared.every((item) =>
      item.dimensions.find((candidate) => candidate.id === dimension.id)?.score !== null,
    )) ?? [];

  if (prepared.length === 0 || dimensions.length < 3) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="font-medium">Rubric profile</h3>
          <InfoTooltip
            label="Rubric profile"
            description="Compares normalized quality dimensions for the selected file. Higher values are better; negative finding rates are inverted."
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {emptyReason ?? "Radar unavailable because fewer than three comparable rubric dimensions were evaluated."}
        </p>
      </div>
    );
  }

  const values = prepared.map((item) => dimensions.map((dimension) =>
    item.dimensions.find((candidate) => candidate.id === dimension.id)?.score ?? 0,
  ));
  const description = prepared.map((item, index) =>
    `${item.label} averages ${percent(mean(values[index]))}`,
  ).join("; ");

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="font-medium">Rubric profile</h3>
          <InfoTooltip
            label="Rubric profile"
            description="Compares normalized quality dimensions for the selected file. Higher values are better; negative finding rates are inverted."
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Normalized claim-level rubric scores for the selected file; higher is better. Negative
          finding rates are inverted. Whole-run fidelity, cost, and latency are not included.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {prepared.map((item, index) => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={index === 0
                ? "h-2.5 w-2.5 rounded-full bg-primary"
                : "h-2.5 w-2.5 rotate-45 bg-amber-600 dark:bg-amber-400"}
            />
            <span className="font-medium">{item.label}</span>
            <span className="text-muted-foreground">{percent(mean(values[index]))} average</span>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mx-auto h-auto w-full max-w-3xl overflow-visible"
        role="img"
        aria-label={prepared.length > 1
          ? `Rubric radar comparing ${prepared.map((item) => item.label).join(" and ")}`
          : `Rubric radar for ${prepared[0].label}`}
      >
        <title>Normalized rubric profile</title>
        <desc>{description}. Higher values indicate better quality.</desc>
        {GRID_LEVELS.map((level) => (
          <polygon
            key={level}
            points={polygonPoints(dimensions.map(() => level))}
            fill="none"
            className="stroke-border"
            strokeWidth={level === 1 ? 1.5 : 1}
            opacity={level === 1 ? 0.9 : 0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {dimensions.map((dimension, index) => {
          const [x, y] = coordinates(index, dimensions.length, RADIUS);
          const [labelX, labelY] = coordinates(index, dimensions.length, LABEL_RADIUS);
          const anchor = labelX < CENTER_X - 8 ? "end" : labelX > CENTER_X + 8 ? "start" : "middle";
          return (
            <g key={dimension.id}>
              <line
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x}
                y2={y}
                className="stroke-border"
                strokeWidth="1"
                opacity="0.7"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[12px] font-medium"
              >
                {dimension.label}
              </text>
            </g>
          );
        })}
        {GRID_LEVELS.map((level) => (
          <text
            key={`tick-${level}`}
            x={CENTER_X + 6}
            y={CENTER_Y - RADIUS * level + 4}
            className="fill-muted-foreground text-[10px]"
          >
            {Math.round(level * 100)}
          </text>
        ))}
        {prepared.map((item, seriesIndex) => (
          <g key={item.label}>
            <polygon
              points={polygonPoints(values[seriesIndex])}
              className={seriesIndex === 0
                ? "fill-primary/10 stroke-primary"
                : "fill-amber-500/10 stroke-amber-600 dark:stroke-amber-400"}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeDasharray={seriesIndex === 0 ? undefined : "7 4"}
              vectorEffect="non-scaling-stroke"
            />
            {values[seriesIndex].map((value, index) => {
              const [x, y] = coordinates(index, dimensions.length, RADIUS * value);
              return seriesIndex === 0 ? (
                <circle key={dimensions[index].id} cx={x} cy={y} r="4" className="fill-primary" />
              ) : (
                <rect
                  key={dimensions[index].id}
                  x={x - 3.5}
                  y={y - 3.5}
                  width="7"
                  height="7"
                  className="fill-amber-600 dark:fill-amber-400"
                />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Exact normalized rubric profile scores</caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Dimension</th>
              {prepared.map((item) => <th key={item.label} className="px-2 py-2 text-right font-medium">{item.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {dimensions.map((dimension, dimensionIndex) => (
              <tr key={dimension.id} className="border-b last:border-0">
                <td className="py-1.5 pr-4"><span className="flex items-center gap-1.5">{dimension.label}<InfoTooltip label={dimension.label} description={dimension.description} /></span></td>
                {prepared.map((item, seriesIndex) => (
                  <td key={item.label} className="px-2 py-1.5 text-right tabular-nums">
                    {percent(values[seriesIndex][dimensionIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        This chart is a visual summary. The enabled rubric results and claim-level findings below
        remain the auditable evaluation record.
      </p>
    </div>
  );
}
