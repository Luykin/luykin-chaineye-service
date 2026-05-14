import { Button, Result } from "antd";
import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="当前路由尚未迁移到新版管理后台。"
      extra={
        <Button type="primary" onClick={() => navigate("/admin-react/dau-details")}>
          返回首页
        </Button>
      }
    />
  );
}
