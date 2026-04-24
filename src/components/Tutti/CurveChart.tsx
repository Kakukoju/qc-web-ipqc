import {
  ComposedChart, Scatter, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface CurveChartProps {
  odData: { l1: number[]; l2: number[]; n1: number[]; n3: number[] };
  concs: { l1: number | null; l2: number | null; n1: number | null; n3: number | null };
  slope: number | null;
  intercept: number | null;
  r2: number | null;
}

const LEVEL_COLORS: Record<string, string> = {
  l1: '#4DA3FF', l2: '#34D399', n1: '#F97316', n3: '#C084FC',
};
const LEVEL_LABELS: Record<string, string> = {
  l1: 'L1', l2: 'L2', n1: 'N1', n3: 'N3',
};

function buildScatterData(
  ods: number[],
  conc: number | null,
): { x: number; y: number }[] {
  if (conc == null || ods.length === 0) return [];
  return ods.map(y => ({ x: conc, y }));
}

function buildRegressionLine(
  slope: number | null,
  intercept: number | null,
  concs: { l1: number | null; l2: number | null; n1: number | null; n3: number | null },
): { x: number; y: number }[] {
  if (slope == null || intercept == null) return [];
  const xs = Object.values(concs).filter((v): v is number => v != null);
  if (xs.length < 2) return [];
  const min = Math.min(...xs) * 0.8;
  const max = Math.max(...xs) * 1.1;
  return [
    { x: min, y: slope * min + intercept },
    { x: max, y: slope * max + intercept },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { x, y } = payload[0].payload;
  return (
    <div className="bg-[#1A2438] border border-[#2A3754] rounded-lg px-3 py-2 text-xs">
      <p className="text-[#93A4C3]">Conc: <span className="text-[#EAF2FF] font-mono">{x?.toFixed(3)}</span></p>
      <p className="text-[#93A4C3]">OD: <span className="text-[#EAF2FF] font-mono">{y?.toFixed(4)}</span></p>
    </div>
  );
}

export default function CurveChart({ odData, concs, slope, intercept, r2 }: CurveChartProps) {
  const regressionLine = buildRegressionLine(slope, intercept, concs);

  const hasData = Object.entries(odData).some(([, arr]) => arr.length > 0);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full text-[#556A88] text-sm">
        尚無 OD 數據
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Regression stats badge */}
      {slope != null && (
        <div className="absolute top-2 right-2 z-10 bg-[#0B1220]/80 border border-[#2A3754] rounded-lg px-3 py-1.5 text-xs font-mono space-y-0.5">
          <p className="text-[#93A4C3]">slope = <span className="text-[#4DA3FF]">{slope.toFixed(6)}</span></p>
          <p className="text-[#93A4C3]">intercept = <span className="text-[#4DA3FF]">{intercept?.toFixed(6)}</span></p>
          {r2 != null && (
            <p className="text-[#93A4C3]">R² = <span className={r2 >= 0.99 ? 'text-[#34D399]' : r2 >= 0.95 ? 'text-[#FBBF24]' : 'text-[#F87171]'}>{r2.toFixed(5)}</span></p>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
          <CartesianGrid stroke="#1A2438" strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            type="number"
            name="Concentration"
            tick={{ fill: '#93A4C3', fontSize: 10 }}
            label={{ value: 'CS Conc', position: 'insideBottomRight', fill: '#556A88', fontSize: 10, offset: -4 }}
            domain={['auto', 'auto']}
          />
          <YAxis
            dataKey="y"
            type="number"
            name="OD"
            tick={{ fill: '#93A4C3', fontSize: 10 }}
            label={{ value: 'OD', angle: -90, position: 'insideLeft', fill: '#556A88', fontSize: 10 }}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: '#93A4C3' }}
            formatter={(value) => <span style={{ color: '#93A4C3' }}>{value}</span>}
          />

          {/* Scatter points per level */}
          {(['l1', 'l2', 'n1', 'n3'] as const).map(level => {
            const pts = buildScatterData(odData[level], concs[level]);
            if (pts.length === 0) return null;
            return (
              <Scatter
                key={level}
                name={LEVEL_LABELS[level]}
                data={pts}
                fill={LEVEL_COLORS[level]}
                opacity={0.85}
                r={5}
              />
            );
          })}

          {/* Regression line */}
          {regressionLine.length === 2 && (
            <Line
              data={regressionLine}
              type="linear"
              dataKey="y"
              stroke="#F59E0B"
              strokeWidth={1.5}
              dot={false}
              name="回歸線"
              legendType="line"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
