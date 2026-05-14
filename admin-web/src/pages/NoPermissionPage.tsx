import { Button, Result } from "antd";
import { buildApiUrl } from "@/services/apiClient";

export function NoPermissionPage() {
  return (
    <Result
      status="403"
      title="无权限访问"
      subTitle="当前账号没有访问该页面的权限，请联系坤哥分配权限。"
      extra={
        <Button type="primary" href={buildApiUrl("/api/xhunt/stats")}>
          返回旧版后台
        </Button>
      }
    />
  );
}
