import { Button, Result } from "antd";
import { useNavigate } from "react-router-dom";

export function NoPermissionPage() {
  const navigate = useNavigate();

  return (
    <Result
      status="403"
      title="无权限访问"
      subTitle="当前账号没有访问该页面的权限，请联系坤哥分配权限。"
      extra={
        <Button type="primary" onClick={() => navigate("/admin-react/dau-details")}>
          返回首页
        </Button>
      }
    />
  );
}
