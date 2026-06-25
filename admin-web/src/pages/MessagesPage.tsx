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
import {
  CheckCircleOutlined,
  EyeOutlined,
  LinkOutlined,
  MessageOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
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

function PreviewMessage({
  username,
  reportUrl,
  title,
  content,
}: {
  username: string;
  reportUrl?: string;
  title: string;
  content: string;
}) {
  return (
    <div className="messages-preview-message">
      <div className="messages-preview-message__head">
        <Tag color="blue" className="messages-user-tag">
          @{username}
        </Tag>
        <Tag icon={<LinkOutlined />} className="messages-link-tag">
          {reportUrl || "无报告链接"}
        </Tag>
      </div>
      <Typography.Text strong className="messages-preview-message__title">
        {title || "-"}
      </Typography.Text>
      <Typography.Paragraph className="messages-preview-message__content">
        {content || "-"}
      </Typography.Paragraph>
    </div>
  );
}

export function MessagesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<{
    campaignId: string;
    title: string;
    content: string;
    handlers: string[];
    reportUrls: string[];
  } | null>(null);
  const [result, setResult] = useState<SendMessagesResponse["data"] | null>(null);

  const handlers = splitLines(Form.useWatch("handlers", form) || "");
  const reportUrls = splitLines(Form.useWatch("reportUrls", form) || "");
  const campaignId = Form.useWatch("campaignId", form) || "";
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

  const hasUrlMismatch = reportUrls.length > 0 && handlers.length > 0 && reportUrls.length !== handlers.length;
  const firstPreview = previewItems[0];
  const readyChecks = [
    { label: "Campaign ID", done: Boolean(campaignId.trim()) },
    { label: "用户列表", done: handlers.length > 0 },
    { label: "消息标题", done: Boolean(title.trim()) },
    { label: "消息正文", done: Boolean(content.trim()) },
  ];
  const readyCount = readyChecks.filter((item) => item.done).length;

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

    setConfirmPayload({
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
      <div className="messages-page">
        <PageSection
          title="站内消息"
          description="批量发送私信给多个用户，支持用户名与报告链接占位符。"
          extra={
            <Space wrap size={8}>
              <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)} disabled={!handlers.length}>
                预览
              </Button>
              <Button
                icon={<SendOutlined />}
                type="primary"
                className="messages-send-button"
                onClick={() => void submit()}
                loading={mutation.isPending}
              >
                发送私信
              </Button>
            </Space>
          }
        >
          <div className="messages-hero">
            <div>
              <div className="messages-hero__eyebrow">XHunt Message Center</div>
              <Typography.Title level={4} className="messages-hero__title">
                批量消息发送台
              </Typography.Title>
              <Typography.Paragraph className="messages-hero__desc">
                使用 <code>{"{{ username }}"}</code> 和 <code>{"{{ reportUrl }}"}</code> 做个性化替换。建议先预览，再发送。
              </Typography.Paragraph>
            </div>
            <div className="messages-hero__panel" aria-label="发送准备状态">
              <div className="messages-hero__score">
                <span>{readyCount}</span>
                <small>/ {readyChecks.length}</small>
              </div>
              <div className="messages-hero__panel-copy">
                <strong>发送前检查</strong>
                <span>{hasUrlMismatch ? "链接数量需要复核" : "基础字段状态正常"}</span>
              </div>
            </div>
          </div>

          {hasUrlMismatch ? (
            <Alert
              className="messages-alert"
              type="warning"
              showIcon
              message="用户数和报告链接数不一致"
              description="链接会按顺序和用户匹配；缺少链接的用户会收到空 reportUrl 替换结果。"
            />
          ) : null}

          <Row gutter={[16, 16]} align="top" className="messages-layout">
            <Col xs={24} xl={15} xxl={16}>
              <Card
                className="messages-card messages-composer-card"
                title={
                  <div className="messages-card-title">
                    <MessageOutlined />
                    <span>消息内容</span>
                  </div>
                }
                bordered
              >
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
                  <Row gutter={[14, 0]}>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="活动 ID"
                        name="campaignId"
                        rules={[{ required: true, message: "请输入活动 ID" }]}
                      >
                        <Input placeholder="例如：kol_report_20250127" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form.Item
                        label="私信标题"
                        name="title"
                        rules={[{ required: true, message: "请输入私信标题" }]}
                      >
                        <Input placeholder="请输入私信标题" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item
                    label={
                      <Space size={8}>
                        <span>用户 Handler</span>
                        <Tag className="messages-count-tag">{handlers.length} 个用户</Tag>
                      </Space>
                    }
                    name="handlers"
                    extra="多个用户用逗号或换行分隔"
                    rules={[{ required: true, message: "请输入至少一个用户 Handler" }]}
                  >
                    <Input.TextArea
                      className="messages-mono-textarea"
                      autoSize={{ minRows: 4, maxRows: 8 }}
                      placeholder="例如：FloriaT96249, luoyukun4, alpha_gege"
                    />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space size={8}>
                        <span>私信内容</span>
                        <Tag color="processing">支持占位符</Tag>
                      </Space>
                    }
                    name="content"
                    rules={[{ required: true, message: "请输入私信内容" }]}
                  >
                    <Input.TextArea
                      className="messages-content-textarea"
                      autoSize={{ minRows: 9, maxRows: 16 }}
                      placeholder="请输入私信内容"
                    />
                  </Form.Item>

                  <Form.Item
                    label={
                      <Space size={8}>
                        <span>报告链接</span>
                        <Tag className="messages-count-tag">{reportUrls.length} 个链接</Tag>
                      </Space>
                    }
                    name="reportUrls"
                    extra="多个链接用逗号或换行分隔，顺序与用户对应"
                  >
                    <Input.TextArea
                      className="messages-mono-textarea"
                      autoSize={{ minRows: 4, maxRows: 8 }}
                      placeholder="https://xhunt.ai/kolreport/..."
                    />
                  </Form.Item>
                </Form>
              </Card>
            </Col>

            <Col xs={24} xl={9} xxl={8}>
              <div className="messages-side-stack">
                <Card
                  className="messages-card messages-overview-card"
                  title={
                    <div className="messages-card-title">
                      <CheckCircleOutlined />
                      <span>发送概览</span>
                    </div>
                  }
                >
                  <Row gutter={[10, 10]}>
                    <Col span={12}>
                      <div className="messages-stat messages-stat--users">
                        <Statistic title="用户数" value={handlers.length} prefix={<UserOutlined />} />
                      </div>
                    </Col>
                    <Col span={12}>
                      <div className="messages-stat messages-stat--links">
                        <Statistic title="链接数" value={reportUrls.length} prefix={<LinkOutlined />} />
                      </div>
                    </Col>
                  </Row>

                  <Divider className="messages-divider" />

                  <div className="messages-checklist">
                    {readyChecks.map((item) => (
                      <div
                        key={item.label}
                        className={item.done ? "messages-check-row is-ready" : "messages-check-row"}
                      >
                        <span>{item.label}</span>
                        <strong>{item.done ? "已填写" : "待补充"}</strong>
                      </div>
                    ))}
                  </div>

                  <Divider className="messages-divider" />

                  <div className="messages-current-title">
                    <Typography.Text type="secondary">当前标题</Typography.Text>
                    <Typography.Paragraph ellipsis={{ rows: 2 }}>
                      {title || "-"}
                    </Typography.Paragraph>
                  </div>
                </Card>

                <Card
                  className="messages-card messages-preview-card"
                  title={
                    <div className="messages-card-title">
                      <EyeOutlined />
                      <span>首条预览</span>
                    </div>
                  }
                >
                  {firstPreview ? (
                    <PreviewMessage
                      username={firstPreview.username}
                      reportUrl={firstPreview.reportUrl}
                      title={title}
                      content={firstPreview.content}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入用户后展示首条预览" />
                  )}
                </Card>

                {result ? (
                  <Card
                    className="messages-card messages-result-card"
                    title={
                      <div className="messages-card-title">
                        <SendOutlined />
                        <span>发送结果</span>
                      </div>
                    }
                  >
                    <Row gutter={[10, 10]}>
                      <Col span={12}>
                        <div className="messages-result-stat messages-result-stat--success">
                          <Statistic title="成功" value={result.success.length} prefix={<CheckCircleOutlined />} />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="messages-result-stat messages-result-stat--missing">
                          <Statistic title="未找到" value={result.notFound.length} prefix={<StopOutlined />} />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="messages-result-stat messages-result-stat--repeat">
                          <Statistic title="已发送过" value={result.alreadySent.length} prefix={<MessageOutlined />} />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="messages-result-stat messages-result-stat--error">
                          <Statistic title="错误" value={result.errors.length} prefix={<WarningOutlined />} />
                        </div>
                      </Col>
                    </Row>
                  </Card>
                ) : null}
              </div>
            </Col>
          </Row>

          {result ? (
            <Card
              className="messages-card messages-detail-card"
              title={
                <div className="messages-card-title">
                  <MessageOutlined />
                  <span>发送明细</span>
                </div>
              }
            >
              <Tabs
                className="messages-result-tabs"
                items={[
                  {
                    key: "success",
                    label: `成功 (${result.success.length})`,
                    children: result.success.length ? (
                      <Space wrap size={[8, 8]}>
                        {result.success.map((item) => (
                          <Tag key={item.messageId} color="success" className="messages-result-tag">
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
                          <Tag key={item} color="default" className="messages-result-tag">
                            @{item}
                          </Tag>
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
                          <Tag key={item} color="warning" className="messages-result-tag">
                            @{item}
                          </Tag>
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
      </div>

      <Modal
        open={!!confirmPayload}
        title="确认发送站内消息？"
        okText="确认发送"
        cancelText="再检查一下"
        confirmLoading={mutation.isPending}
        onCancel={() => setConfirmPayload(null)}
        onOk={() => {
          if (!confirmPayload) return;
          mutation.mutate(confirmPayload);
          setConfirmPayload(null);
        }}
      >
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          将向 <Typography.Text strong>{confirmPayload?.handlers.length || 0}</Typography.Text> 个用户发送：
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          <Typography.Text strong>{confirmPayload?.title || "-"}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          发送后会记录 campaignId，重复发送会被后端拦截。
        </Typography.Text>
      </Modal>

      <Modal
        open={previewOpen}
        title="私信预览"
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={760}
      >
        {previewItems.length ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }} className="messages-modal-preview-list">
            {previewItems.slice(0, 10).map((item, index) => (
              <PreviewMessage
                key={`${item.username}-${index}`}
                username={item.username}
                reportUrl={item.reportUrl}
                title={title}
                content={item.content}
              />
            ))}
            {previewItems.length > 10 ? (
              <Alert
                type="info"
                showIcon
                message={`仅展示前 10 条预览，实际会发送 ${previewItems.length} 条。`}
              />
            ) : null}
          </Space>
        ) : (
          <Empty description="暂无可预览内容" />
        )}
      </Modal>
    </PermissionGuard>
  );
}
