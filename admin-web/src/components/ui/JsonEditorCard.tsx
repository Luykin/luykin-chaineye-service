import { Card, Input, Space, Typography } from "antd";

interface JsonEditorCardProps {
  title: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  height?: number;
  extra?: React.ReactNode;
}

export function JsonEditorCard({
  title,
  description,
  value,
  onChange,
  height = 420,
  extra,
}: JsonEditorCardProps) {
  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{title}</Typography.Text>
          {description ? (
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {description}
            </Typography.Text>
          ) : null}
        </Space>
      }
      extra={extra}
    >
      <Input.TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        style={{
          minHeight: height,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        }}
      />
    </Card>
  );
}
