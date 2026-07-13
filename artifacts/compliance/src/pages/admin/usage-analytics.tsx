import { 
  useGetComplianceTrends, 
  useGetCategoryDistribution, 
  useGetViolationDistribution, 
  useGetVendorPerformance, 
  useGetDashboardStats,
  useGetLanguageQuality 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, PieChart, Pie, Cell 
} from "recharts";
import { Loader2, TrendingUp, PieChart as PieChartIcon, BarChart2, Briefcase } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// Inline loading spinner for a single card body. Each widget renders its own so
// one slow/failed query can never freeze the whole page (previously the page
// blocked on ALL six queries at once — a single stalled request left the entire
// screen spinning with no recovery).
function CardLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function CardEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground bg-muted/20 rounded-lg">
      {text}
    </div>
  );
}

export default function UsageAnalytics() {
  const { data: trends, isLoading: trendsLoading } = useGetComplianceTrends();
  const { data: categories, isLoading: categoriesLoading } = useGetCategoryDistribution();
  const { data: violations, isLoading: violationsLoading } = useGetViolationDistribution();
  const { data: vendors, isLoading: vendorsLoading } = useGetVendorPerformance();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: langQuality, isLoading: langLoading } = useGetLanguageQuality();

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp className="w-7 h-7 text-primary" /> Usage & Analytics
        </h1>
        <p className="text-muted-foreground mt-1">Platform usage, outcome trends, and ecosystem metrics.</p>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardContent className="p-6 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Reviews YTD</div>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mt-3" />
            ) : (
              <div className="text-4xl font-bold mt-2 text-foreground">{stats?.totalPackages ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Overall Pass Rate</div>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mt-3" />
            ) : (
              <div className="text-4xl font-bold mt-2 text-success">
                {stats?.totalPackages ? Math.round((stats.passed / stats.totalPackages) * 100) : 0}%
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col justify-center">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Language Quality Score</div>
            {langLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mt-3" />
            ) : (
              <div className="text-4xl font-bold mt-2 text-primary">
                {langQuality?.averageScore ? Math.round(langQuality.averageScore) : 0} <span className="text-lg text-muted-foreground font-normal">/ 100</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Compliance Trends</CardTitle>
            <CardDescription>Volume and pass/fail rates over time.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {trendsLoading ? (
              <CardLoading />
            ) : trends && trends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPassed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} 
                    tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="passed" stroke="hsl(var(--success))" strokeWidth={2} fillOpacity={1} fill="url(#colorPassed)" />
                  <Area type="monotone" dataKey="failed" stroke="hsl(var(--destructive))" strokeWidth={2} fillOpacity={1} fill="url(#colorFailed)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <CardEmpty text="No trend data available" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PieChartIcon className="w-5 h-5 text-primary" /> Category Distribution</CardTitle>
            <CardDescription>Review volume by product category.</CardDescription>
          </CardHeader>
          <CardContent className="min-h-80">
            {categoriesLoading ? (
              <div className="h-72"><CardLoading /></div>
            ) : categories && categories.length > 0 ? (
              <div className="flex flex-col gap-4">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categories} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {categories.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Custom legend: hierarchical category paths are long, so each
                    entry gets its own wrapping chip (color marker + truncated
                    label with the full path on hover) instead of Recharts'
                    fixed-height legend, which overlaps long labels. */}
                <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  {categories.map((cat, index) => (
                    <li key={`legend-${index}`} className="flex items-center gap-1.5 min-w-0 max-w-full">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        aria-hidden
                      />
                      <span className="truncate text-muted-foreground" title={cat.label}>
                        {cat.label}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">{cat.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="h-72"><CardEmpty text="No category data available" /></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart2 className="w-5 h-5 text-primary" /> Violations by Engine</CardTitle>
            <CardDescription>Distribution of compliance engine triggers.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {violationsLoading ? (
              <CardLoading />
            ) : violations && violations.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={violations} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} width={100} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <CardEmpty text="No violation data available" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-primary" /> Top Vendor Performance</CardTitle>
            <CardDescription>Compliance scorecard for major suppliers.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Packages</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right w-[200px]">Compliance Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorsLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : vendors && vendors.length > 0 ? vendors.slice(0, 5).map(v => (
                  <TableRow key={v.vendor}>
                    <TableCell className="font-medium text-foreground">{v.vendor}</TableCell>
                    <TableCell className="text-right">{v.packages}</TableCell>
                    <TableCell className="text-right text-destructive font-medium">{v.failed}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-3">
                        <Progress value={v.complianceScore} className="h-2 w-24" />
                        <span className="text-xs font-bold w-9 text-right text-foreground">{v.complianceScore}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No vendor data available</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
