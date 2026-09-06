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
import TradingViewChart from "@/pages/TradingViewChart";
import MaxPainResearch from "@/pages/MaxPainResearch";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { AdminPageGate } from "./components/AdminPageGate";
import { AuthProvider } from "./contexts/AuthContext";
import { useAuth } from "./_core/hooks/useAuth";
import Login from "./pages/Login";

const ProtectedDashboard = () => (
  <AdminPageGate page="dashboard">
    <Dashboard />
  </AdminPageGate>
);
const ProtectedPositions = () => (
  <AdminPageGate page="positions">
    <Positions />
  </AdminPageGate>
);
const ProtectedMatrix = () => (
  <AdminPageGate page="matrix">
    <Matrix />
  </AdminPageGate>
);
const ProtectedTradingView = () => (
  <AdminPageGate page="tradingView">
    <TradingViewChart />
  </AdminPageGate>
);
const ProtectedMaxPain = () => (
  <AdminPageGate page="maxPain">
    <MaxPainResearch />
  </AdminPageGate>
);
const ProtectedFormulas = () => (
  <AdminPageGate page="formulas">
    <Formulas />
  </AdminPageGate>
);
const ProtectedDataSources = () => (
  <AdminPageGate page="dataSources">
    <DataSources />
  </AdminPageGate>
);
const ProtectedSettings = () => (
  <AdminPageGate page="settings">
    <Settings />
  </AdminPageGate>
);
const ProtectedOptionDetail = () => (
  <AdminPageGate page="optionDetail">
    <OptionDetail />
  </AdminPageGate>
);
const ProtectedNotFound = () => (
  <AdminPageGate page="notFound">
    <NotFound />
  </AdminPageGate>
);

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={ProtectedMatrix} />
        <Route path="/positions" component={ProtectedPositions} />
        <Route path="/matrix" component={ProtectedMatrix} />
        <Route path="/charts" component={ProtectedTradingView} />
        <Route path="/max-pain" component={ProtectedMaxPain} />
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

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Router /> : <Login />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <AuthenticatedApp />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
