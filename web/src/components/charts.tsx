import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} width={34} allowDecimals={false} />
        <Tooltip content={<ChartTip />} />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#trendgrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CategoryBars({ data, color }: { data: { label: string; value: number }[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(130, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} width={130} />
        <Tooltip content={<ChartTip />} cursor={{ fill: 'hsl(var(--secondary))' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={color ?? 'hsl(var(--primary))'} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}
