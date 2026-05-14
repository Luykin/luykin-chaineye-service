import { Card, Space, Typography } from "antd";

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
      styles={{
        body: { padding: 20 },
      }}
      title={
        <Space direction="vertical" size={2}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {title}
          </Typography.Text>
          {description ? (
            <Typography.Text type="secondary">{description}</Typography.Text>
          ) : null}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}
