import { createBrowserRouter, Navigate } from "react-router-dom";
import { AdminLayout } from "@/layouts/AdminLayout";
import { GenericStatsPage } from "@/pages/GenericStatsPage";
import { AuditLogsPage } from "@/pages/AuditLogsPage";
import { UrlStatsPage } from "@/pages/UrlStatsPage";
import { VersionStatsPage } from "@/pages/VersionStatsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { DauDetailsPage } from "@/pages/DauDetailsPage";
import { OnlineUsersPage } from "@/pages/OnlineUsersPage";

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
      {
        path: "generic-stats",
        element: <GenericStatsPage />,
      },
      {
        path: "dau-details",
        element: <DauDetailsPage />,
      },
      {
        path: "online-users",
        element: <OnlineUsersPage />,
      },
      {
        path: "admin-audit-logs",
        element: <AuditLogsPage />,
      },
      {
        path: "url-stats",
        element: <UrlStatsPage />,
      },
      {
        path: "version-stats",
        element: <VersionStatsPage />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
