import { useAuth } from "@/app/auth";
import { NoPermissionPage } from "@/pages/NoPermissionPage";

interface PermissionGuardProps {
  permission?: string | string[];
  children: React.ReactNode;
}

export function PermissionGuard({ permission, children }: PermissionGuardProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return <NoPermissionPage />;
  }

  return <>{children}</>;
}
