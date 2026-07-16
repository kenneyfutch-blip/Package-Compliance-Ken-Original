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
  BarChart, Bar 
} from "recharts";
import { Loader2, TrendingUp, PieChart as PieChartIcon, BarChart2, Briefcase } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

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
          <CardContent>
            {categoriesLoading ? (
              <div className="h-72"><CardLoading /></div>
            ) : categories && categories.length > 0 ? (
              // A pie with this many near-equal, low-count categories is
              // unreadable (repeating colors, no slice-to-label mapping). A
              // ranked bar list scans top-to-bottom: sorted by volume, full
              // labels, count and relative size visible at a glance.
              (() => {
                const ranked = [...categories].sort(
                  (a, b) => b.count - a.count || a.label.localeCompare(b.label),
                );
                const max = ranked[0]?.count ?? 0;
                return (
                  <ul className="space-y-3">
                    {ranked.map((cat, index) => (
                      <li key={`cat-${index}`} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-foreground truncate" title={cat.label}>
                            {cat.label}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                            {cat.count}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${max > 0 ? (cat.count / max) * 100 : 0}%`,
                              backgroundColor: "hsl(var(--chart-1))",
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                );
              })()
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
          <CardContent>
            {violationsLoading ? (
              <div className="h-80"><CardLoading /></div>
            ) : violations && violations.length > 0 ? (
              // Height scales with the number of engines so bars keep clear
              // spacing and multi-line labels never collide, no matter how many
              // categories come back.
              <div style={{ height: Math.max(320, violations.length * 48) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={violations} layout="vertical" barCategoryGap="35%" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} width={148} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                    <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-80"><CardEmpty text="No violation data available" /></div>
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
