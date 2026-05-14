import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { sendBatchMessages } from "@/services/admin-tools";
import type { SendMessagesResponse } from "@/types/admin-tools";

function splitLines(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function MessagesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [result, setResult] = useState<SendMessagesResponse["data"] | null>(null);

  const handlers = splitLines(Form.useWatch("handlers", form) || "");
  const reportUrls = splitLines(Form.useWatch("reportUrls", form) || "");
  const title = Form.useWatch("title", form) || "";
  const content = Form.useWatch("content", form) || "";

  const previewItems = useMemo(
    () =>
      handlers.map((username, index) => {
        const reportUrl = reportUrls[index] || "";
        return {
          username,
          reportUrl,
          content: content
            .replace(/\{\{\s*username\s*\}\}/g, username)
            .replace(/\{\{\s*reportUrl\s*\}\}/g, reportUrl),
        };
      }),
    [content, handlers, reportUrls]
  );

  const mutation = useMutation({
    mutationFn: sendBatchMessages,
    onSuccess: (response) => {
      messageApi.success(response.message || "私信发送完成");
      setResult(response.data);
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "发送私信失败");
    },
  });

  const submit = async () => {
    const values = await form.validateFields();
    const nextHandlers = splitLines(values.handlers);
    const nextUrls = splitLines(values.reportUrls || "");
    mutation.mutate({
      campaignId: values.campaignId.trim(),
      title: values.title.trim(),
      content: values.content,
      handlers: nextHandlers,
      reportUrls: nextUrls,
    });
  };

  return (
    <PermissionGuard permission="messages">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="站内消息"
          description="批量发送私信给多个用户，支持用户名与报告链接占位符。"
          extra={
            <Space>
              <Button onClick={() => setPreviewOpen(true)} disabled={!handlers.length}>
                预览私信
              </Button>
              <Button type="primary" onClick={() => void submit()} loading={mutation.isPending}>
                发送私信
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="占位符说明"
            description="支持 {{ username }} 和 {{ reportUrl }}，发送时会按用户逐条替换。"
          />

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={16}>
              <Card>
                <Form
                  form={form}
                  layout="vertical"
                  initialValues={{
                    campaignId: "kol_report_20251023",
                    title: "🎉 您的专属KOL分析报告已生成！",
                    content:
                      "GM {{ username }}，\n\n感谢您一直以来对 XHunt 的支持与喜爱 💫\n报告链接：{{ reportUrl }}\n\n再次感谢您对 XHunt 社区的信任与陪伴！",
                  }}
                >
                  <Form.Item
                    label="活动 ID"
                    name="campaignId"
                    rules={[{ required: true, message: "请输入活动 ID" }]}
                  >
                    <Input placeholder="例如：kol_report_20250127" />
                  </Form.Item>

                  <Form.Item
                    label="用户 Handler"
                    name="handlers"
                    extra="多个用户用逗号或换行分隔"
                    rules={[{ required: true, message: "请输入至少一个用户 Handler" }]}
                  >
                    <Input.TextArea
                      rows={5}
                      placeholder="例如：FloriaT96249, luoyukun4, alpha_gege"
                    />
                  </Form.Item>

                  <Form.Item
                    label="私信标题"
                    name="title"
                    rules={[{ required: true, message: "请输入私信标题" }]}
                  >
                    <Input placeholder="请输入私信标题" />
                  </Form.Item>

                  <Form.Item
                    label="私信内容"
                    name="content"
                    rules={[{ required: true, message: "请输入私信内容" }]}
                  >
                    <Input.TextArea rows={10} placeholder="请输入私信内容" />
                  </Form.Item>

                  <Form.Item label="报告链接" name="reportUrls" extra="多个链接用逗号或换行分隔，顺序与用户对应">
                    <Input.TextArea rows={5} placeholder="https://xhunt.ai/kolreport/..." />
                  </Form.Item>
                </Form>
              </Card>
            </Col>

            <Col xs={24} xl={8}>
              <Card title="发送概览">
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Row gutter={[12, 12]}>
                    <Col span={12}>
                      <Card size="small">
                        <Statistic title="用户数" value={handlers.length} />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small">
                        <Statistic title="链接数" value={reportUrls.length} />
                      </Card>
                    </Col>
                  </Row>

                  <div>
                    <Typography.Text type="secondary">当前标题</Typography.Text>
                    <Typography.Paragraph style={{ marginBottom: 0, marginTop: 6 }}>
                      {title || "-"}
                    </Typography.Paragraph>
                  </div>

                  <Divider style={{ margin: "4px 0" }} />

                  <div>
                    <Typography.Text type="secondary">示例替换结果</Typography.Text>
                    {previewItems.length ? (
                      <Card size="small" style={{ marginTop: 8, background: "#fafafa" }}>
                        <Space direction="vertical" size={6} style={{ width: "100%" }}>
                          <Tag color="blue">@{previewItems[0].username}</Tag>
                          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                            {previewItems[0].content}
                          </Typography.Paragraph>
                        </Space>
                      </Card>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无预览数据" />
                    )}
                  </div>
                </Space>
              </Card>

              {result ? (
                <Card title="发送结果" style={{ marginTop: 16 }}>
                  <Row gutter={[12, 12]}>
                    <Col span={12}><Statistic title="成功" value={result.success.length} /></Col>
                    <Col span={12}><Statistic title="未找到" value={result.notFound.length} /></Col>
                    <Col span={12}><Statistic title="已发送过" value={result.alreadySent.length} /></Col>
                    <Col span={12}><Statistic title="错误" value={result.errors.length} /></Col>
                  </Row>
                </Card>
              ) : null}
            </Col>
          </Row>

          {result ? (
            <Card title="发送明细" style={{ marginTop: 16 }}>
              <Tabs
                items={[
                  {
                    key: "success",
                    label: `成功 (${result.success.length})`,
                    children: result.success.length ? (
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {result.success.map((item) => (
                          <Tag key={item.messageId} color="success">
                            @{item.username} · {item.messageId}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无成功记录" />
                    ),
                  },
                  {
                    key: "notFound",
                    label: `未找到 (${result.notFound.length})`,
                    children: result.notFound.length ? (
                      <Space wrap>
                        {result.notFound.map((item) => (
                          <Tag key={item} color="default">@{item}</Tag>
                        ))}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无未找到记录" />
                    ),
                  },
                  {
                    key: "alreadySent",
                    label: `已发送过 (${result.alreadySent.length})`,
                    children: result.alreadySent.length ? (
                      <Space wrap>
                        {result.alreadySent.map((item) => (
                          <Tag key={item} color="warning">@{item}</Tag>
                        ))}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无重复发送记录" />
                    ),
                  },
                  {
                    key: "errors",
                    label: `错误 (${result.errors.length})`,
                    children: result.errors.length ? (
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {result.errors.map((item) => (
                          <Alert
                            key={`${item.username}-${item.error}`}
                            type="error"
                            showIcon
                            message={`@${item.username}`}
                            description={item.error}
                          />
                        ))}
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无错误记录" />
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </PageSection>
      </Space>

      <Modal
        open={previewOpen}
        title="私信预览"
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={760}
      >
        {previewItems.length ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {previewItems.slice(0, 10).map((item, index) => (
              <Card key={`${item.username}-${index}`} size="small">
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color="blue">@{item.username}</Tag>
                    <Tag>{item.reportUrl || "无报告链接"}</Tag>
                  </Space>
                  <Typography.Text strong>{title || "-"}</Typography.Text>
                  <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                    {item.content}
                  </Typography.Paragraph>
                </Space>
              </Card>
            ))}
            {previewItems.length > 10 ? (
              <Typography.Text type="secondary">
                仅展示前 10 条预览，实际会发送 {previewItems.length} 条。
              </Typography.Text>
            ) : null}
          </Space>
        ) : (
          <Empty description="暂无可预览内容" />
        )}
      </Modal>
    </PermissionGuard>
  );
}
