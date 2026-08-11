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
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/positions" component={Positions} />
        <Route path="/matrix" component={Matrix} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/formulas" component={Formulas} />
        <Route path="/data-sources" component={DataSources} />
        <Route path="/option/:id" component={OptionDetail} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
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
