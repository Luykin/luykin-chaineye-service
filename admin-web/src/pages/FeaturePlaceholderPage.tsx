import { Button, Result, Space, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";

interface FeaturePlaceholderPageProps {
  title: string;
  permission?: string;
}

export function FeaturePlaceholderPage({ title, permission }: FeaturePlaceholderPageProps) {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title={title}
      subTitle="该页面入口已迁移到新版后台，但页面主体尚未完成迁移。"
      extra={
        <Space>
          {permission ? <Tag color="blue">{permission}</Tag> : null}
          <Typography.Text type="secondary">可先从侧边栏保留完整导航结构</Typography.Text>
          <Button type="primary" onClick={() => navigate("/overview")}>
            返回首页
          </Button>
        </Space>
      }
    />
  );
}
