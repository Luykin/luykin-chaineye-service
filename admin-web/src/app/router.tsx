import type { ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AdminLayout } from "@/layouts/AdminLayout";
import { GenericStatsPage } from "@/pages/GenericStatsPage";
import { AuditLogsPage } from "@/pages/AuditLogsPage";
import { UrlStatsPage } from "@/pages/UrlStatsPage";
import { VersionStatsPage } from "@/pages/VersionStatsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { CohortsPage } from "@/pages/CohortsPage";
import { DauDetailsPage } from "@/pages/DauDetailsPage";
import { DeviceMonitorPage } from "@/pages/DeviceMonitorPage";
import { NotesPage } from "@/pages/NotesPage";
import { OnlineUsersPage } from "@/pages/OnlineUsersPage";
import { LogSearchPage } from "@/pages/LogSearchPage";
import { RootdataPage } from "@/pages/RootdataPage";
import { SecurityViolationsPage } from "@/pages/SecurityViolationsPage";
import { ReviewsManagementPage } from "@/pages/ReviewsManagementPage";
import { MessagesPage } from "@/pages/MessagesPage";
import { ServerCommandPage } from "@/pages/ServerCommandPage";
import { BinanceSquarePage } from "@/pages/BinanceSquarePage";
import { PerfMonitorPage } from "@/pages/PerfMonitorPage";
import { NacosMessagesPage } from "@/pages/NacosMessagesPage";
import { NacosCampaignsPage } from "@/pages/NacosCampaignsPage";
import { NacosTagsPage } from "@/pages/NacosTagsPage";
import { FeatureFlagsPage } from "@/pages/FeatureFlagsPage";
import { RedisManagementPage } from "@/pages/RedisManagementPage";
import { LlmTestPage } from "@/pages/LlmTestPage";
import { DailyReportEmailPage } from "@/pages/DailyReportEmailPage";
import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { VipManagementPage } from "@/pages/VipManagementPage";
import { FeaturePlaceholderPage } from "@/pages/FeaturePlaceholderPage";
import { adminMainNavItems } from "@/config/admin-navigation";

const implementedRouteElements: Record<string, ReactNode> = {
  overview: <OverviewPage />,
  "generic-stats": <GenericStatsPage />,
  cohorts: <CohortsPage />,
  "dau-details": <DauDetailsPage />,
  rootdata: <RootdataPage />,
  "online-users": <OnlineUsersPage />,
  notes: <NotesPage />,
  "log-search": <LogSearchPage />,
  "device-monitor": <DeviceMonitorPage />,
  "admin-audit-logs": <AuditLogsPage />,
  "url-stats": <UrlStatsPage />,
  "version-stats": <VersionStatsPage />,
  "security-violations": <SecurityViolationsPage />,
  messages: <MessagesPage />,
  "reviews-management": <ReviewsManagementPage />,
  "server-command": <ServerCommandPage />,
  "binance-square": <BinanceSquarePage />,
  "perf-monitor": <PerfMonitorPage />,
  "nacos-messages": <NacosMessagesPage />,
  "nacos-campaigns": <NacosCampaignsPage />,
  "nacos-tags": <NacosTagsPage />,
  "feature-flags": <FeatureFlagsPage />,
  "redis-management": <RedisManagementPage />,
  "llm-test": <LlmTestPage />,
  "daily-report-email": <DailyReportEmailPage />,
  "admin-users": <AdminUsersPage />,
  "vip-management": <VipManagementPage />,
};

const generatedAdminRoutes = adminMainNavItems.map((item) => {
  const path = item.key.replace("/admin-react/", "");
  return {
    path,
    element:
      implementedRouteElements[path] ?? (
        <FeaturePlaceholderPage title={item.label} permission={item.permission} />
      ),
  };
});

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/admin-react/overview" replace />,
  },
  {
    path: "/admin-react",
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/admin-react/overview" replace />,
      },
      ...generatedAdminRoutes,
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
