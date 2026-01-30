import React from "react";

interface DataPoint {
  label: string;
  value: number;
}

interface SimpleLineChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  title?: string;
}

export function SimpleLineChart({
  data,
  height = 200,
  color = "rgb(59, 130, 246)", // blue-500
  showGrid = true,
  title,
}: SimpleLineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No data available
      </div>
    );
  }

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = 800;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Calculate scales
  const maxValue = Math.max(...data.map((d) => d.value));
  const minValue = Math.min(...data.map((d) => d.value));
  const valueRange = maxValue - minValue || 1;

  const xScale = (index: number) => (index / (data.length - 1 || 1)) * innerWidth + padding.left;
  const yScale = (value: number) =>
    chartHeight - padding.bottom - ((value - minValue) / valueRange) * innerHeight;

  // Generate path
  const pathData = data
    .map((point, index) => {
      const x = xScale(index);
      const y = yScale(point.value);
      return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(" ");

  // Generate area path (for fill under line)
  const areaPathData = `${pathData} L ${xScale(data.length - 1)} ${chartHeight - padding.bottom} L ${xScale(0)} ${chartHeight - padding.bottom} Z`;

  // Y-axis ticks
  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    const value = minValue + (valueRange / (yTicks - 1)) * i;
    return Math.round(value);
  });

  return (
    <div className="w-full">
      {title && <h4 className="text-sm font-medium mb-4">{title}</h4>}
      <svg
        width="100%"
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="overflow-visible"
      >
        {/* Grid lines */}
        {showGrid && (
          <g className="opacity-10">
            {yTickValues.map((value, i) => (
              <line
                key={`grid-${i}`}
                x1={padding.left}
                y1={yScale(value)}
                x2={chartWidth - padding.right}
                y2={yScale(value)}
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
          </g>
        )}

        {/* Area under line */}
        <path
          d={areaPathData}
          fill={color}
          fillOpacity="0.1"
        />

        {/* Line */}
        <path
          d={pathData}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((point, index) => (
          <g key={index}>
            <circle
              cx={xScale(index)}
              cy={yScale(point.value)}
              r="4"
              fill={color}
              className="hover:r-6 transition-all cursor-pointer"
            >
              <title>{`${point.label}: ${point.value}`}</title>
            </circle>
          </g>
        ))}

        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={chartHeight - padding.bottom}
          stroke="currentColor"
          strokeWidth="1"
          className="opacity-30"
        />

        {/* Y-axis labels */}
        {yTickValues.map((value, i) => (
          <text
            key={`y-label-${i}`}
            x={padding.left - 10}
            y={yScale(value)}
            textAnchor="end"
            alignmentBaseline="middle"
            className="text-xs fill-current text-muted-foreground"
          >
            {value}
          </text>
        ))}

        {/* X-axis */}
        <line
          x1={padding.left}
          y1={chartHeight - padding.bottom}
          x2={chartWidth - padding.right}
          y2={chartHeight - padding.bottom}
          stroke="currentColor"
          strokeWidth="1"
          className="opacity-30"
        />

        {/* X-axis labels (show every few labels to avoid crowding) */}
        {data.map((point, index) => {
          const showLabel = data.length <= 10 || index % Math.ceil(data.length / 7) === 0;
          if (!showLabel) return null;

          return (
            <text
              key={`x-label-${index}`}
              x={xScale(index)}
              y={chartHeight - padding.bottom + 20}
              textAnchor="middle"
              className="text-xs fill-current text-muted-foreground"
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
