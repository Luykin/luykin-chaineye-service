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
import { NotesPage } from "@/pages/NotesPage";
import { OnlineUsersPage } from "@/pages/OnlineUsersPage";
import { LogSearchPage } from "@/pages/LogSearchPage";
import { FeaturePlaceholderPage } from "@/pages/FeaturePlaceholderPage";
import { adminMainNavItems } from "@/config/admin-navigation";

const implementedRouteElements: Record<string, ReactNode> = {
  overview: <OverviewPage />,
  "generic-stats": <GenericStatsPage />,
  cohorts: <CohortsPage />,
  "dau-details": <DauDetailsPage />,
  "online-users": <OnlineUsersPage />,
  notes: <NotesPage />,
  "log-search": <LogSearchPage />,
  "admin-audit-logs": <AuditLogsPage />,
  "url-stats": <UrlStatsPage />,
  "version-stats": <VersionStatsPage />,
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
    element: <Navigate to="/admin-react/dau-details" replace />,
  },
  {
    path: "/admin-react",
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/admin-react/dau-details" replace />,
      },
      ...generatedAdminRoutes,
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
