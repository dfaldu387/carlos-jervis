import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const AXIS = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';

interface TipProps {
  active?: boolean;
  payload?: { value: number; payload: { label: string } }[];
  label?: string;
}

function ChartTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium text-foreground">{payload[0].payload?.label ?? label}</div>
      <div className="text-muted-foreground">{payload[0].value}</div>
    </div>
  );
}

export function TrendArea({ data, height = 220 }: { data: { date: string; count: number }[]; height?: number }) {
  const d = data.map((p) => ({ label: p.date.slice(5), value: p.count }));
  // Explicit unique integer ticks on a "nice" domain, so the axis never shows
  // fractional values rounded to the same label twice.
  const max = d.reduce((m, p) => Math.max(m, p.value), 0);
  const niceMax = max <= 4 ? Math.max(1, max) : Math.ceil(max / 4) * 4;
  const ticks = Array.from(new Set([0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax].map((v) => Math.round(v))));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={d} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="trendgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} width={34} domain={[0, niceMax]} ticks={ticks} allowDecimals={false} />
        <Tooltip content={<ChartTip />} />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#trendgrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CategoryBars({ data, color }: { data: { label: string; value: number }[]; color?: string }) {
  // A single-series magnitude chart: one hue, no legend (the card title names
  // it), and a direct value label at each bar end instead of a competing x-axis
  // and gridlines. Labels wear a text token, never the bar colour.
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} width={130} />
        <Tooltip content={<ChartTip />} cursor={{ fill: 'hsl(var(--secondary))' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={color ?? 'hsl(var(--primary))'} barSize={18} maxBarSize={24}>
          <LabelList dataKey="value" position="right" offset={8} style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
