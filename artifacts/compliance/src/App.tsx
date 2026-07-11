import { useEffect, useRef } from "react"
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from "wouter"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useClerk,
  useUser,
} from "@clerk/react"
import { publishableKeyFromHost } from "@clerk/react/internal"
import { shadcn } from "@clerk/themes"
import { ThemeProvider } from "@/components/theme-provider"
import { Shell } from "@/components/layout"
import { PermissionProvider, usePermissions, requiredPermFor, NoAccess } from "@/lib/access"
import { Button } from "@/components/ui/button"
import { ShieldCheck, Loader2, Lock } from "lucide-react"
import NotFound from "@/pages/not-found"
import Dashboard from "@/pages/dashboard"
import Landing from "@/pages/landing"
import UploadPage from "@/pages/upload"
import BulkQueuePage from "@/pages/bulk"
import ReviewWorkspace from "@/pages/review-workspace"
import AdminPage from "@/pages/admin"
import ReportsPage from "@/pages/reports"
import RegulationsPage from "@/pages/regulations"
import SuppliersPage from "@/pages/suppliers"
import NotificationsPage from "@/pages/notifications"
import UserManagement from "@/pages/operations/users"
import TeamManagement from "@/pages/operations/teams"
import RoleManagement from "@/pages/operations/roles"
import WorkloadDashboard from "@/pages/operations/workload"
import AuditCenter from "@/pages/operations/audit-center"
import SystemHealthPage from "@/pages/operations/system"
import PackagesView from "@/pages/packages"
import FastReview from "@/pages/fast-review"
import ViolationsView from "@/pages/violations-center"
import LanguageReviewCenter from "@/pages/language-review-center"
import Heatmaps from "@/pages/heatmaps"
import VendorScorecards from "@/pages/vendor-scorecards"
import ExecutiveReports from "@/pages/executive-reports"
import TrendAnalysis from "@/pages/trend-analysis"
import RegulatoryLibrary from "@/pages/regulatory-library"
import RegulatoryUpdates from "@/pages/regulatory-updates"
import FdaRecalls from "@/pages/fda-recalls"
import FdaSources from "@/pages/fda-sources"
import SupplierPortal from "@/pages/supplier-portal"
import SupplierDetail from "@/pages/supplier-detail"

const queryClient = new QueryClient()

// REQUIRED — resolves the key from window.location.hostname so the same build
// serves multiple Clerk custom domains. Copy verbatim.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
)
// REQUIRED — empty in dev, auto-set in prod. Do not gate on NODE_ENV/PROD.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

// Only Dollar Tree associates may use the app. Server enforces this too.
const ALLOWED_DOMAINS = ["dollartree.com"]
function emailAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf("@")
  if (at === -1) return false
  return ALLOWED_DOMAINS.includes(email.slice(at + 1).toLowerCase())
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in environment")
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#1F47FF",
    colorForeground: "#0B1220",
    colorMutedForeground: "#64748B",
    colorBackground: "#FFFFFF",
    colorInput: "#FFFFFF",
    colorInputForeground: "#0B1220",
    colorDanger: "#F0325B",
    colorNeutral: "#0B1220",
    fontFamily: '"Geist", sans-serif',
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border shadow-xl rounded-2xl w-[440px] max-w-full overflow-hidden",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground",
    formFieldLabel: "text-foreground",
    footerActionLink: "text-primary",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
  },
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex items-center gap-2 text-primary">
        <ShieldCheck className="h-7 w-7" />
        <span className="text-xl font-bold tracking-tight">Packaging Compliance AI</span>
      </div>
      {children}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Access is restricted to Dollar Tree associates.
      </p>
    </div>
  )
}

function SignInPage() {
  return (
    <AuthShell>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthShell>
  )
}

function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthShell>
  )
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
}

function AccessRestricted({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <Lock className="h-7 w-7" />
      </div>
      <h1 className="mt-6 text-2xl font-bold text-foreground">Access restricted</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        Packaging Compliance AI is available only to Dollar Tree associates. The account
        {email ? ` ${email}` : ""} is not a Dollar Tree email address.
      </p>
      <Button className="mt-6" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  )
}

// Client-side gate for UX. The API server independently enforces the same rule.
function DomainGate({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  if (!isLoaded) return <FullScreenLoader />
  const email = user?.primaryEmailAddress?.emailAddress ?? null
  if (!emailAllowed(email)) {
    return <AccessRestricted email={email} onSignOut={() => signOut({ redirectUrl: basePath || "/" })} />
  }
  return <>{children}</>
}

const REG_LIBS: Record<string, { agency: string; title: string; subtitle: string }> = {
  fda: { agency: "FDA", title: "FDA Library", subtitle: "Food & Drug Administration labeling and safety rules." },
  epa: { agency: "EPA", title: "EPA Library", subtitle: "Environmental Protection Agency registration and pesticide rules." },
  cpsc: { agency: "CPSC", title: "CPSC Library", subtitle: "Consumer Product Safety Commission requirements." },
  ftc: { agency: "FTC", title: "FTC Library", subtitle: "Federal Trade Commission advertising and claims rules." },
  usda: { agency: "USDA", title: "USDA Library", subtitle: "Department of Agriculture labeling standards." },
  sop: { agency: "Internal", title: "Internal SOP Library", subtitle: "Dollar Tree internal standards and procedures." },
}

function AppRoutes() {
  const [location] = useLocation()
  const { has, isLoading } = usePermissions()
  const required = requiredPermFor(location)
  const blocked = !isLoading && required !== null && !has(required)

  return (
    <Shell>
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : blocked ? (
        <NoAccess />
      ) : (
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
        <Route path="/regulatory/recalls" component={FdaRecalls} />
        <Route path="/regulatory/sources" component={FdaSources} />
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
        <Route path="/ai/language" component={LanguageReviewCenter} />
        <Route path="/ai/fixes">{() => <ViolationsView mode="fixes" />}</Route>
        <Route path="/ai/claims">{() => <ViolationsView mode="claims" />}</Route>
        <Route path="/ai/memory">{() => <ViolationsView mode="memory" />}</Route>
        <Route path="/ai/heatmaps" component={Heatmaps} />

        {/* Suppliers */}
        <Route path="/suppliers" component={SuppliersPage} />
        <Route path="/suppliers/scorecards" component={VendorScorecards} />
        <Route path="/suppliers/portal" component={SupplierPortal} />
        <Route path="/suppliers/:id" component={SupplierDetail} />

        {/* Reports */}
        <Route path="/reports" component={ReportsPage} />
        <Route path="/reports/executive" component={ExecutiveReports} />
        <Route path="/reports/trends" component={TrendAnalysis} />

        {/* Operations */}
        <Route path="/operations/users" component={UserManagement} />
        <Route path="/operations/teams" component={TeamManagement} />
        <Route path="/operations/roles" component={RoleManagement} />
        <Route path="/operations/workload" component={WorkloadDashboard} />
        <Route path="/operations/audit" component={AuditCenter} />
        <Route path="/operations/system" component={SystemHealthPage} />

        <Route path="/admin" component={AdminPage} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route component={NotFound} />
      </Switch>
      )}
    </Shell>
  )
}

function ProtectedArea() {
  return (
    <>
      <Show when="signed-in">
        <DomainGate>
          <PermissionProvider>
            <AppRoutes />
          </PermissionProvider>
        </DomainGate>
      </Show>
      <Show when="signed-out">
        <Switch>
          <Route path="/" component={Landing} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Show>
    </>
  )
}

// Invalidates cached queries when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk()
  const qc = useQueryClient()
  const prevUserIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear()
      }
      prevUserIdRef.current = userId
    })
    return unsubscribe
  }, [addListener, qc])
  return null
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation()
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Sign in with your Dollar Tree account" } },
        signUp: { start: { title: "Create your account", subtitle: "Use your Dollar Tree email address" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={ProtectedArea} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  )
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="compliance-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeProvider>
  )
}

export default App;
