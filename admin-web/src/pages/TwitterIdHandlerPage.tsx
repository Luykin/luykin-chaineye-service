import { useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  SearchOutlined,
  SwapOutlined,
  TwitterOutlined,
} from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { lookupTwitterIdHandler } from "@/services/twitter-id-handler";
import type { TwitterIdHandlerLookupData } from "@/types/twitter-id-handler";

type LookupMode = "twitterId" | "handler";

const LOOKUP_PERMISSION = "twitter-id-handler";

function ResultField({ label, value, copyable = true, onCopy }: { label: string; value: string; copyable?: boolean; onCopy: (label: string, value: string) => void }) {
  return (
    <div className="twitter-lookup-result-field">
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Space size={8}>
        <Typography.Text code className="twitter-lookup-result-value">
          {value || "-"}
        </Typography.Text>
        {copyable && value ? <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制${label}`} onClick={() => onCopy(label, value)} /> : null}
      </Space>
    </div>
  );
}

function LookupResult({ data, onCopy }: { data: TwitterIdHandlerLookupData; onCopy: (label: string, value: string) => void }) {
  return (
    <Card className="twitter-lookup-result-card" size="small">
      <div className="twitter-lookup-result-heading">
        <Space size={12}>
          <Avatar src={data.avatar || undefined} icon={<TwitterOutlined />} size={44} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>{data.displayName || `@${data.handler}`}</Typography.Title>
            <Typography.Text type="secondary">@{data.handler}</Typography.Text>
          </div>
        </Space>
        <Tag color="success" icon={<CheckCircleOutlined />}>已找到</Tag>
      </div>
      <Divider style={{ margin: "16px 0" }} />
      <Row gutter={[16, 12]}>
        <Col xs={24} md={12}><ResultField label="Twitter ID" value={data.twitterId} onCopy={onCopy} /></Col>
        <Col xs={24} md={12}><ResultField label="Handler" value={`@${data.handler}`} onCopy={onCopy} /></Col>
      </Row>
      <div className="twitter-lookup-result-footer">
        <Typography.Text type="secondary">数据来源：Twitter profile 服务</Typography.Text>
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => onCopy("Twitter ID", data.twitterId)}>复制 ID</Button>
          <Button type="primary" icon={<LinkOutlined />} href={data.twitterUrl} target="_blank" rel="noreferrer">打开 X 主页</Button>
        </Space>
      </div>
    </Card>
  );
}

export function TwitterIdHandlerPage() {
  const [mode, setMode] = useState<LookupMode>("twitterId");
  const [form] = Form.useForm<{ value: string }>();
  const [messageApi, contextHolder] = message.useMessage();
  const mutation = useMutation({
    mutationFn: (value: string) => mode === "twitterId" ? lookupTwitterIdHandler({ twitterId: value }) : lookupTwitterIdHandler({ handler: value }),
    onError: (error: Error) => messageApi.error(error.message || "查询失败"),
  });

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      messageApi.success(`${label}已复制`);
    } catch {
      messageApi.error("复制失败，请手动选择文本");
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    mutation.reset();
    mutation.mutate(values.value.trim());
  };

  const switchMode = (next: LookupMode) => {
    setMode(next);
    mutation.reset();
    form.resetFields();
  };

  return (
    <PermissionGuard permission={LOOKUP_PERMISSION}>
      {contextHolder}
      <PageSection
        title="Twitter ID 转换"
        description="调试工具 · 通过外部 Twitter profile 服务查询账号标识。"
      >
        <div className="twitter-lookup-page">
          <Card className="twitter-lookup-intro-card" bordered={false}>
            <div className="twitter-lookup-intro-icon"><SwapOutlined /></div>
            <div className="twitter-lookup-intro-copy">
              <Typography.Text className="twitter-lookup-eyebrow">DEVELOPER TOOL / READ ONLY</Typography.Text>
              <Typography.Title level={2} className="twitter-lookup-intro-title">Twitter ID ↔ Handler</Typography.Title>
              <Typography.Paragraph type="secondary" className="twitter-lookup-intro-description">
                输入任意一项，快速获取对应的账号标识。支持带 @ 的 handler 或 X/Twitter 主页链接。
              </Typography.Paragraph>
            </div>
            <Tag color="blue" className="twitter-lookup-readonly-tag">只读查询</Tag>
          </Card>

          <Card className="twitter-lookup-form-card" bordered={false}>
            <div className="twitter-lookup-section-heading">
              <Typography.Text strong>选择查询方向</Typography.Text>
              <Typography.Text type="secondary">结果来自外部 Twitter profile 服务</Typography.Text>
            </div>
            <Space direction="vertical" size={18} style={{ width: "100%" }}>
              <Segmented
                block
                value={mode}
                onChange={(value) => switchMode(value as LookupMode)}
                options={[
                  { label: "Twitter ID → Handler", value: "twitterId" },
                  { label: "Handler → Twitter ID", value: "handler" },
                ]}
              />
              <Form form={form} layout="vertical" className="twitter-lookup-form" onFinish={() => void submit()}>
                <Form.Item
                  name="value"
                  label={mode === "twitterId" ? "Twitter ID" : "Handler"}
                  extra={mode === "twitterId" ? "只需输入数字 ID，例如 783214" : "可输入 @username 或 x.com/username"}
                  rules={[
                    { required: true, message: mode === "twitterId" ? "请输入 Twitter ID" : "请输入 handler" },
                    ...(mode === "twitterId" ? [{ pattern: /^\d{1,30}$/, message: "Twitter ID 必须是数字" }] : []),
                  ]}
                >
                  <Input
                    size="large"
                    prefix={mode === "twitterId" ? <TwitterOutlined /> : <span className="twitter-lookup-input-prefix">@</span>}
                    placeholder={mode === "twitterId" ? "输入 Twitter 数字 ID" : "输入 handler，例如 x"}
                    allowClear
                  />
                </Form.Item>
                <Button type="primary" size="large" htmlType="submit" icon={<SearchOutlined />} loading={mutation.isPending} block>
                  查询账号
                </Button>
              </Form>
            </Space>
          </Card>

          <div className="twitter-lookup-result-section" aria-live="polite">
            {mutation.data?.data ? <LookupResult data={mutation.data.data} onCopy={(label, value) => void copyValue(label, value)} /> : (
              <div className="twitter-lookup-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : "查询失败，请稍后重试") : "提交查询后，结果会显示在这里"}
                />
              </div>
            )}
          </div>
        </div>
      </PageSection>
    </PermissionGuard>
  );
}
