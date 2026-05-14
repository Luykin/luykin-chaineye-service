import { Alert } from "antd";
import { useAuth } from "@/app/auth";

interface PermissionGuardProps {
  permission?: string | string[];
  children: React.ReactNode;
}

export function PermissionGuard({ permission, children }: PermissionGuardProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return (
      <Alert
        type="warning"
        showIcon
        message="权限不足"
        description="当前账号暂无访问此页面的权限，请联系坤哥分配权限。"
      />
    );
  }

  return <>{children}</>;
}
