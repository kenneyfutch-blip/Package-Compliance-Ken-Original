import { Route, Switch, Router as WouterRouter } from "wouter"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { Shell } from "@/components/layout"
import NotFound from "@/pages/not-found"
import Dashboard from "@/pages/dashboard"
import UploadPage from "@/pages/upload"
import BulkQueuePage from "@/pages/bulk"
import ReviewsPage from "@/pages/reviews"
import ReviewWorkspace from "@/pages/review-workspace"
import AdminPage from "@/pages/admin"

const queryClient = new QueryClient()

// Dummy placeholders for other routes until built
const Reports = () => <div className="p-8">Reports coming soon</div>
const Regulations = () => <div className="p-8">Regulations coming soon</div>
const Suppliers = () => <div className="p-8">Suppliers coming soon</div>
const Audit = () => <div className="p-8">Audit log coming soon</div>
const Notifications = () => <div className="p-8">Notifications coming soon</div>

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/upload" component={UploadPage} />
        <Route path="/bulk" component={BulkQueuePage} />
        <Route path="/reviews" component={ReviewsPage} />
        <Route path="/reviews/:id" component={ReviewWorkspace} />
        <Route path="/reports" component={Reports} />
        <Route path="/regulations" component={Regulations} />
        <Route path="/suppliers" component={Suppliers} />
        <Route path="/audit" component={Audit} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/notifications" component={Notifications} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="compliance-theme">
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
          <Router />
        </WouterRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App;
