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
import { LayoutDashboard, PanelLeft, Grid3X3, ListPlus, Calculator, Database, Settings, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { LiveSpotBar } from "./LiveSpotBar";
import { MarketRefreshButton } from "./MarketRefreshButton";
import { AutoMarketRefresh } from "./AutoMarketRefresh";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ListPlus, label: "仓位管理", path: "/positions" },
  { icon: Grid3X3, label: "风险热力图", path: "/matrix" },
  { icon: Calculator, label: "公式管理", path: "/formulas" },
  { icon: Database, label: "数据来源", path: "/data-sources" },
  { icon: Settings, label: "设置", path: "/settings" },
];

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
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
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
              {menuItems.map(item => {
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
              <p className="text-xs font-medium text-foreground">本地单用户模式</p>
              <p className="text-[11px] text-muted-foreground mt-1">数据保存在本机，可导出备份</p>
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 hidden sm:inline-flex"
              onClick={() => setPageZoom(1)}
              disabled={pageZoom === 1}
              aria-label="恢复默认缩放"
              title="恢复默认缩放"
            >
              <RotateCcw className="h-3.5 w-3.5" />
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
