import { Route, Switch, Router as WouterRouter } from "wouter"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { Shell } from "@/components/layout"
import NotFound from "@/pages/not-found"
import Dashboard from "@/pages/dashboard"
import UploadPage from "@/pages/upload"
import BulkQueuePage from "@/pages/bulk"
import ReviewWorkspace from "@/pages/review-workspace"
import AdminPage from "@/pages/admin"
import ReportsPage from "@/pages/reports"
import RegulationsPage from "@/pages/regulations"
import SuppliersPage from "@/pages/suppliers"
import AuditPage from "@/pages/audit"
import NotificationsPage from "@/pages/notifications"
import PackagesView from "@/pages/packages"
import FastReview from "@/pages/fast-review"
import ViolationsView from "@/pages/violations-center"
import Heatmaps from "@/pages/heatmaps"
import VendorScorecards from "@/pages/vendor-scorecards"
import ExecutiveReports from "@/pages/executive-reports"
import TrendAnalysis from "@/pages/trend-analysis"
import RegulatoryLibrary from "@/pages/regulatory-library"
import RegulatoryUpdates from "@/pages/regulatory-updates"
import SupplierPortal from "@/pages/supplier-portal"

const queryClient = new QueryClient()

const REG_LIBS: Record<string, { agency: string; title: string; subtitle: string }> = {
  fda: { agency: "FDA", title: "FDA Library", subtitle: "Food & Drug Administration labeling and safety rules." },
  epa: { agency: "EPA", title: "EPA Library", subtitle: "Environmental Protection Agency registration and pesticide rules." },
  cpsc: { agency: "CPSC", title: "CPSC Library", subtitle: "Consumer Product Safety Commission requirements." },
  ftc: { agency: "FTC", title: "FTC Library", subtitle: "Federal Trade Commission advertising and claims rules." },
  usda: { agency: "USDA", title: "USDA Library", subtitle: "Department of Agriculture labeling standards." },
  sop: { agency: "Internal", title: "Internal SOP Library", subtitle: "Dollar Tree internal standards and procedures." },
}

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/upload" component={UploadPage} />

        {/* Review Queue */}
        <Route path="/reviews">
          <PackagesView title="My Reviews" subtitle="Packages assigned to you for compliance review." emptyText="No reviews assigned right now." />
        </Route>
        <Route path="/reviews/:id" component={ReviewWorkspace} />
        <Route path="/queue/high-risk">
          <PackagesView title="High Risk Queue" subtitle="Packages with the highest compliance risk scores." riskFilter="high" emptyText="No high-risk packages. Nicely done." />
        </Route>
        <Route path="/bulk" component={BulkQueuePage} />
        <Route path="/fast-review" component={FastReview} />
        <Route path="/queue/assigned">
          <PackagesView title="Assigned Reviews" subtitle="Everything currently in your review workload." emptyText="Nothing assigned yet." />
        </Route>

        {/* Packages */}
        <Route path="/packages">
          <PackagesView title="All Packages" subtitle="Every packaging record in the system." />
        </Route>
        <Route path="/packages/active">
          <PackagesView title="Active Reviews" subtitle="Packages currently in AI or specialist review." statusFilter="AI Review" emptyText="No active reviews in progress." />
        </Route>
        <Route path="/packages/approved">
          <PackagesView title="Approved Packages" subtitle="Packages cleared for production." statusFilter="Approved" emptyText="No packages approved yet." />
        </Route>
        <Route path="/packages/rejected">
          <PackagesView title="Rejected Packages" subtitle="Packages returned for revision." statusFilter="Needs Revision" emptyText="No rejected packages." />
        </Route>
        <Route path="/packages/archived">
          <PackagesView title="Archived Packages" subtitle="Packages retired from active review." statusFilter="Archived" emptyText="No archived packages yet." />
        </Route>

        {/* Regulatory Intelligence */}
        <Route path="/regulatory/:agency">
          {(params) => {
            const cfg = REG_LIBS[params.agency ?? ""] ?? {
              agency: params.agency ?? "",
              title: `${(params.agency ?? "").toUpperCase()} Library`,
              subtitle: "Regulatory rules.",
            }
            return <RegulatoryLibrary agency={cfg.agency} title={cfg.title} subtitle={cfg.subtitle} />
          }}
        </Route>
        <Route path="/regulatory-updates" component={RegulatoryUpdates} />
        <Route path="/regulations" component={RegulationsPage} />

        {/* AI Compliance */}
        <Route path="/ai/violations">{() => <ViolationsView mode="center" />}</Route>
        <Route path="/ai/fixes">{() => <ViolationsView mode="fixes" />}</Route>
        <Route path="/ai/claims">{() => <ViolationsView mode="claims" />}</Route>
        <Route path="/ai/memory">{() => <ViolationsView mode="memory" />}</Route>
        <Route path="/ai/heatmaps" component={Heatmaps} />

        {/* Suppliers */}
        <Route path="/suppliers" component={SuppliersPage} />
        <Route path="/suppliers/scorecards" component={VendorScorecards} />
        <Route path="/suppliers/portal" component={SupplierPortal} />

        {/* Reports */}
        <Route path="/reports" component={ReportsPage} />
        <Route path="/reports/executive" component={ExecutiveReports} />
        <Route path="/reports/trends" component={TrendAnalysis} />

        <Route path="/audit" component={AuditPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="compliance-theme">
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App;
