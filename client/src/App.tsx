import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// Keep route components in the same production bundle. React 19 + Wouter 3's
// component prop can otherwise resolve lazy route modules outside the active
// hook dispatcher, producing React error #321 only after a minified build.
import Dashboard from "@/pages/Dashboard";
import DataSources from "@/pages/DataSources";
import Formulas from "@/pages/Formulas";
import Matrix from "@/pages/Matrix";
import NotFound from "@/pages/NotFound";
import OptionDetail from "@/pages/OptionDetail";
import Positions from "@/pages/Positions";
import Settings from "@/pages/Settings";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { AdminPageGate } from "./components/AdminPageGate";

const ProtectedDashboard = () => <AdminPageGate><Dashboard /></AdminPageGate>;
const ProtectedFormulas = () => <AdminPageGate><Formulas /></AdminPageGate>;
const ProtectedDataSources = () => <AdminPageGate><DataSources /></AdminPageGate>;
const ProtectedSettings = () => <AdminPageGate><Settings /></AdminPageGate>;
const ProtectedOptionDetail = () => <AdminPageGate><OptionDetail /></AdminPageGate>;
const ProtectedNotFound = () => <AdminPageGate><NotFound /></AdminPageGate>;

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={ProtectedDashboard} />
        <Route path="/positions" component={Positions} />
        <Route path="/matrix" component={Matrix} />
        <Route path="/dashboard" component={ProtectedDashboard} />
        <Route path="/formulas" component={ProtectedFormulas} />
        <Route path="/data-sources" component={ProtectedDataSources} />
        <Route path="/settings" component={ProtectedSettings} />
        <Route path="/option/:id" component={ProtectedOptionDetail} />
        <Route path="/404" component={ProtectedNotFound} />
        <Route component={ProtectedNotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
