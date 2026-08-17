import { useAuth } from "@/_core/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, PanelLeft, Grid3X3, ListPlus, Calculator, Database, Settings, ZoomIn, ZoomOut, LogOut } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { LiveSpotBar } from "./LiveSpotBar";
import { MarketRefreshButton } from "./MarketRefreshButton";
import { AutoMarketRefresh } from "./AutoMarketRefresh";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { trpc } from "@/lib/trpc";

const menuItems = [
  { key: "dashboard", icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { key: "positions", icon: ListPlus, label: "仓位管理", path: "/positions" },
  { key: "matrix", icon: Grid3X3, label: "市场热力图", path: "/matrix" },
  { key: "formulas", icon: Calculator, label: "公式管理", path: "/formulas" },
  { key: "dataSources", icon: Database, label: "数据来源", path: "/data-sources" },
  { key: "settings", icon: Settings, label: "设置", path: "/settings" },
] as const;

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const PAGE_ZOOM_KEY = "page-zoom";
const MIN_PAGE_ZOOM = 0.2;
const MAX_PAGE_ZOOM = 1.4;

const clampZoom = (value: number) => Math.min(MAX_PAGE_ZOOM, Math.max(MIN_PAGE_ZOOM, value));

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  return (
    <SidebarProvider
      defaultOpen={false}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { settings } = usePortfolioSettings();
  const viewerPages = trpc.access.viewerPages.useQuery(undefined, {
    enabled: user?.role !== "admin",
    staleTime: 5_000,
  });
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const visibleMenuItems = menuItems.filter(item => user?.role === "admin"
    ? settings.visiblePages[item.key]
    : item.key !== "settings" && Boolean(viewerPages.data?.[item.key]));
  const isMobile = useIsMobile();
  const [pageZoom, setPageZoom] = useState(() => {
    const saved = Number(localStorage.getItem(PAGE_ZOOM_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampZoom(saved) : 1;
  });

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  useEffect(() => {
    localStorage.setItem(PAGE_ZOOM_KEY, String(pageZoom));
  }, [pageZoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setPageZoom(current => clampZoom(Number((current + 0.1).toFixed(2))));
      } else if (event.key === "-") {
        event.preventDefault();
        setPageZoom(current => clampZoom(Number((current - 0.1).toFixed(2))));
      } else if (event.key === "0") {
        event.preventDefault();
        setPageZoom(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <AutoMarketRefresh />
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-gold-gradient">
                    黄金期权对冲
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {visibleMenuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal`}
                    >
                      <item.icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-medium text-foreground">{user?.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{user?.role === "admin" ? "管理员" : "受限用户"} · 刷新后需重新登录</p></div><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut className="h-4 w-4" /></Button></div>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        <div className="flex border-b min-h-14 flex-wrap items-center justify-between gap-2 bg-background/95 px-2 py-2 sm:px-4 backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg bg-background shrink-0" />}
            <span className="tracking-tight text-foreground truncate">
              {activeMenuItem?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="order-3 flex w-full justify-end overflow-x-auto lg:order-none lg:ml-auto lg:w-auto">
            <LiveSpotBar />
          </div>
          <div className="flex items-center gap-1 shrink-0" role="group" aria-label="页面缩放">
            <MarketRefreshButton compact />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageZoom(current => clampZoom(Number((current - 0.1).toFixed(2))))}
              disabled={pageZoom <= MIN_PAGE_ZOOM}
              aria-label="缩小全部页面"
              title="缩小全部页面，最低 20%（Alt -）"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={() => setPageZoom(1)}
              className="h-8 min-w-14 rounded-md px-2 text-xs font-mono text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="恢复 100%（Alt 0）"
              aria-label={`当前页面缩放 ${Math.round(pageZoom * 100)}%，点击恢复`}
            >
              {Math.round(pageZoom * 100)}%
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageZoom(current => clampZoom(Number((current + 0.1).toFixed(2))))}
              disabled={pageZoom >= MAX_PAGE_ZOOM}
              aria-label="放大全部页面"
              title="放大全部页面（Alt +）"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <main className="flex-1 p-3 sm:p-4 overflow-x-hidden">
          <div
            className="page-zoom-surface origin-top-left"
            style={{ zoom: pageZoom } as CSSProperties}
            data-page-zoom={pageZoom}
          >
            {children}
          </div>
        </main>
      </SidebarInset>
    </>
  );
}
