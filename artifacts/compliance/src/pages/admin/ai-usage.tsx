import { useMemo, useState } from "react";
import {
  useGetAiUsageAnalytics,
  useListAiUsageRequests,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  DollarSign,
  Activity,
  Cpu,
  TrendingUp,
  Layers,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// Friendly labels for AI workloads (mirrors the server WORKLOAD_LABELS).
const OPERATION_LABELS: Record<string, string> = {
  packaging_analysis: "Packaging analysis",
  language_review: "Language review",
  copilot: "Compliance copilot",
  ocr: "Artwork OCR",
  field_extraction: "Metadata extraction",
  version_compare: "Version comparison",
};
const opLabel = (op: string) => OPERATION_LABELS[op] ?? op;

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function toDayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const fmtUsd = (n: number) =>
  n >= 100
    ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`;
const fmtInt = (n: number) => n.toLocaleString();
const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : `${n}`;

export default function AiUsageDashboard() {
  const [days, setDays] = useState(30);

  const { from, to } = useMemo(() => {
    const today = new Date();
    const end = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      ),
    );
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return { from: toDayStr(start), to: toDayStr(end) };
  }, [days]);

  const { data: analytics, isLoading } = useGetAiUsageAnalytics({ from, to });
  const { data: requests, isLoading: requestsLoading } = useListAiUsageRequests(
    { from, to, limit: 50 },
  );

  const summary = analytics?.summary;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-primary" /> AI Usage &amp; Cost
          </h1>
          <p className="text-muted-foreground mt-1">
            Spend, volume, model mix, escalations and reliability across every AI
            request.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              size="sm"
              variant={days === r.days ? "default" : "ghost"}
              onClick={() => setDays(r.days)}
              className="h-8"
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<DollarSign className="w-4 h-4" />}
              label="Estimated Spend"
              value={fmtUsd(summary?.totalCostUsd ?? 0)}
              tone="text-primary"
            />
            <KpiCard
              icon={<Activity className="w-4 h-4" />}
              label="Total Requests"
              value={fmtInt(summary?.totalRequests ?? 0)}
            />
            <KpiCard
              icon={<Cpu className="w-4 h-4" />}
              label="Tokens Used"
              value={fmtTokens(summary?.totalTokens ?? 0)}
            />
            <KpiCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Avg Latency"
              value={`${(((summary?.avgDurationMs ?? 0) / 1000)).toFixed(1)}s`}
            />
            <KpiCard
              icon={<ArrowUpRight className="w-4 h-4" />}
              label="Success Rate"
              value={`${summary?.successRate ?? 0}%`}
              tone="text-success"
            />
            <KpiCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Error Rate"
              value={`${summary?.errorRate ?? 0}%`}
              tone={
                (summary?.errorRate ?? 0) > 0 ? "text-destructive" : undefined
              }
            />
            <KpiCard
              icon={<Layers className="w-4 h-4" />}
              label="Escalation Rate"
              value={`${summary?.escalationRate ?? 0}%`}
            />
            <KpiCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Errors"
              value={fmtInt(summary?.errorCount ?? 0)}
            />
          </div>

          {/* Spend & volume over time */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" /> Spend &amp; Volume
                Over Time
              </CardTitle>
              <CardDescription>
                Estimated daily cost (area) and request volume (line).
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              {analytics && analytics.timeseries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={analytics.timeseries}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="hsl(var(--chart-1))"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="hsl(var(--chart-1))"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis
                      yAxisId="cost"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <YAxis
                      yAxisId="req"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "8px",
                        color: "hsl(var(--foreground))",
                      }}
                      labelFormatter={(v) => new Date(v).toLocaleDateString()}
                      formatter={(value, name) =>
                        name === "costUsd"
                          ? [fmtUsd(Number(value)), "Cost"]
                          : [fmtInt(Number(value)), "Requests"]
                      }
                    />
                    <Area
                      yAxisId="cost"
                      type="monotone"
                      dataKey="costUsd"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2}
                      fill="url(#costFill)"
                    />
                    <Line
                      yAxisId="req"
                      type="monotone"
                      dataKey="requests"
                      stroke="hsl(var(--chart-3))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No AI usage recorded in this range" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {/* By operation */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary" /> Cost by Operation
                </CardTitle>
                <CardDescription>
                  Estimated spend per AI workload.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                {analytics && analytics.byOperation.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={analytics.byOperation.map((o) => ({
                        ...o,
                        label: opLabel(o.operation),
                      }))}
                      layout="vertical"
                      margin={{ top: 0, right: 16, left: 20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                        width={120}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "8px",
                          color: "hsl(var(--foreground))",
                        }}
                        formatter={(value) => [fmtUsd(Number(value)), "Cost"]}
                      />
                      <Bar
                        dataKey="costUsd"
                        fill="hsl(var(--chart-2))"
                        radius={[0, 4, 4, 0]}
                        barSize={22}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart label="No operation data" />
                )}
              </CardContent>
            </Card>

            {/* By model */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-primary" /> Requests by Model
                </CardTitle>
                <CardDescription>Model &amp; tier mix.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-80">
                {analytics && analytics.byModel.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analytics.byModel}
                            dataKey="requests"
                            nameKey="model"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={90}
                            paddingAngle={2}
                          >
                            {analytics.byModel.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              borderColor: "hsl(var(--border))",
                              borderRadius: "8px",
                              color: "hsl(var(--foreground))",
                            }}
                            formatter={(value, _n, item) => [
                              `${fmtInt(Number(value))} req · ${fmtUsd(
                                Number(
                                  (item?.payload as { costUsd?: number })
                                    ?.costUsd ?? 0,
                                ),
                              )}`,
                              (item?.payload as { model?: string })?.model ?? "",
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                      {analytics.byModel.map((m, index) => (
                        <li
                          key={`legend-${index}`}
                          className="flex items-center gap-1.5 min-w-0 max-w-full"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                CHART_COLORS[index % CHART_COLORS.length],
                            }}
                            aria-hidden
                          />
                          <span
                            className="truncate text-muted-foreground"
                            title={m.model}
                          >
                            {m.model}
                            {m.tier ? ` (${m.tier})` : ""}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-foreground">
                            {fmtInt(m.requests)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <EmptyChart label="No model data" />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Operation breakdown table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" /> Operation Breakdown
              </CardTitle>
              <CardDescription>
                Requests, tokens, spend and escalations per workload.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Escalations</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics && analytics.byOperation.length > 0 ? (
                    analytics.byOperation.map((o) => (
                      <TableRow key={o.operation}>
                        <TableCell className="font-medium text-foreground">
                          {opLabel(o.operation)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(o.requests)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtTokens(o.tokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {o.escalations > 0 ? (
                            <Badge variant="secondary">{o.escalations}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtUsd(o.costUsd)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No AI usage recorded in this range
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Recent requests */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" /> Recent Requests
              </CardTitle>
              <CardDescription>
                The 50 most recent AI requests in this range.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestsLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        <Loader2 className="w-5 h-5 animate-spin text-primary inline" />
                      </TableCell>
                    </TableRow>
                  ) : requests && requests.length > 0 ? (
                    requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {opLabel(r.workload)}
                          {r.escalated ? (
                            <ArrowUpRight className="w-3.5 h-3.5 inline ml-1 text-amber-500" />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.model}
                          {r.tier ? (
                            <span className="text-xs"> ({r.tier})</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.userName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtTokens(r.totalTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtUsd(r.costUsd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {(r.durationMs / 1000).toFixed(1)}s
                        </TableCell>
                        <TableCell className="text-right">
                          {r.success ? (
                            <Badge
                              variant="outline"
                              className="border-success/40 text-success"
                            >
                              OK
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Error</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No AI requests recorded in this range
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </div>
        <div className={`text-2xl font-bold mt-2 ${tone ?? "text-foreground"}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground bg-muted/20 rounded-lg">
      {label}
    </div>
  );
}
