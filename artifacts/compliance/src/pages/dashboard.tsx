import { useGetDashboardStats, useGetComplianceTrends, useGetCategoryDistribution, useGetVendorPerformance, useGetLanguageQuality } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { 
  Package, ShieldAlert, CheckCircle, AlertTriangle, 
  Clock, Activity, BarChart2, TrendingUp, Languages 
} from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts"
import { Link } from "wouter"

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats()
  const { data: trends, isLoading: trendsLoading } = useGetComplianceTrends()
  const { data: categories, isLoading: categoriesLoading } = useGetCategoryDistribution()
  const { data: vendors, isLoading: vendorsLoading } = useGetVendorPerformance()
  const { data: langQuality } = useGetLanguageQuality()

  if (statsLoading || trendsLoading || categoriesLoading || vendorsLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Command Center</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-24 bg-muted/20" />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Command Center</h1>
          <p className="text-muted-foreground mt-1">Enterprise Packaging Compliance OS</p>
        </div>
        <div className="flex gap-2">
          <Link href="/bulk">
            <Button variant="outline" className="gap-2">
              <Activity className="w-4 h-4" />
              Analyze Queue
            </Button>
          </Link>
          <Link href="/upload">
            <Button className="gap-2">
              <Package className="w-4 h-4" />
              Upload Package
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className="hover-elevate transition-all"
          style={{
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
          }}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Reviewed</CardTitle>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
              <BarChart2 className="h-4 w-4 text-primary" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalPackages.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-success font-medium">+{stats?.reviewedToday}</span> today
            </p>
          </CardContent>
        </Card>
        
        <Card
          className="hover-elevate transition-all"
          style={{
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
          }}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Passed</CardTitle>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-success/10">
              <CheckCircle className="h-4 w-4 text-success" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.passed.toLocaleString()}</div>
            <Progress 
              value={(stats?.passed || 0) / (stats?.totalPackages || 1) * 100} 
              className="mt-2" 
              indicatorColor="bg-success"
            />
          </CardContent>
        </Card>

        <Card
          className="hover-elevate transition-all"
          style={{
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
          }}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical Violations</CardTitle>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10">
              <ShieldAlert className="h-4 w-4 text-destructive" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.criticalViolations.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Requires immediate action
            </p>
          </CardContent>
        </Card>

        <Card
          className="hover-elevate transition-all"
          style={{
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
          }}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compliance Velocity</CardTitle>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-warning/10">
              <Clock className="h-4 w-4 text-warning" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.complianceVelocity}/day</div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {stats?.avgReviewMinutes}m per review
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Language Quality */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="flex items-center gap-2"><Languages className="w-5 h-5 text-primary" /> Language Quality</CardTitle>
            <CardDescription>AI Language Review Engine across reviewed packaging</CardDescription>
          </div>
          <Link href="/ai/language">
            <Button variant="outline" size="sm">View findings</Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex items-center gap-6">
              <div>
                <div className={`text-5xl font-black ${(langQuality?.averageScore ?? 0) >= 90 ? 'text-success' : (langQuality?.averageScore ?? 0) >= 80 ? 'text-warning' : langQuality?.averageScore == null ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {langQuality?.averageScore ?? "-"}
                </div>
                <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Avg Score</p>
              </div>
              <div className="space-y-1">
                <div className="text-sm"><span className="font-bold">{langQuality?.reviewedCount ?? 0}</span> <span className="text-muted-foreground">reviewed</span></div>
                <div className="text-sm"><span className="font-bold text-destructive">{langQuality?.criticalFindings ?? 0}</span> <span className="text-muted-foreground">critical findings</span></div>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ["Spelling", langQuality?.spelling],
                ["Grammar", langQuality?.grammar],
                ["Context", langQuality?.context],
                ["Regulatory", langQuality?.regulatory],
                ["Marketing", langQuality?.marketing],
                ["Brand", langQuality?.brand],
              ] as const).map(([label, val]) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 bg-accent/40 border border-border rounded-md">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-sm font-bold">{val ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        {/* Main Chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Compliance Trends</CardTitle>
            <CardDescription>Review volume and pass/fail rates over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends || []} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="passed" stroke="hsl(var(--success))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="failed" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Vendor Performance */}
        <Card className="col-span-3 flex flex-col">
          <CardHeader>
            <CardTitle>Vendor Performance</CardTitle>
            <CardDescription>Lowest performing suppliers</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-4">
              {vendors?.slice(0,5).map(vendor => (
                <div key={vendor.vendor} className="flex items-center justify-between group">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{vendor.vendor}</p>
                    <p className="text-xs text-muted-foreground">{vendor.packages} packages</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={vendor.complianceScore > 80 ? 'success' : vendor.complianceScore > 60 ? 'warning' : 'destructive'}>
                      {vendor.complianceScore}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
