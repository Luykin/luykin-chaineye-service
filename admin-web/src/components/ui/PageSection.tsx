import { Card, Space, Typography } from "antd";
import "@/styles/global.css";

interface PageSectionProps {
  title: string;
  description?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}

export function PageSection({
  title,
  description,
  extra,
  children,
}: PageSectionProps) {
  return (
    <Card
      className="admin-page-section"
      styles={{
        body: { padding: 20 },
      }}
      title={
        <Space direction="vertical" size={0} className="admin-page-section__title-group">
          <Typography.Text strong className="admin-page-section__title">
            {title}
          </Typography.Text>
          {description ? (
            <Typography.Text type="secondary" className="admin-page-section__description">
              {description}
            </Typography.Text>
          ) : null}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}
