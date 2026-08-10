import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
const Positions = lazy(() => import("./pages/Positions"));
const Matrix = lazy(() => import("./pages/Matrix"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Formulas = lazy(() => import("./pages/Formulas"));
const OptionDetail = lazy(() => import("./pages/OptionDetail"));
const DataSources = lazy(() => import("./pages/DataSources"));
import DashboardLayout from "./components/DashboardLayout";
import { Loader2 } from "lucide-react";

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
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
