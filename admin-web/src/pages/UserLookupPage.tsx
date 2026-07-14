import { Button, Card, Col, Descriptions, Empty, Form, Input, Row, Space, Table, Tag, Typography, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchCreatorAuth, fetchUserPrivateMessages } from "@/services/admin-tools";
import type { UserPrivateMessageItem } from "@/types/admin-tools";

const CREATOR_STATUS_COLORS: Record<number, string> = {
  0: "default",
  1: "processing",
  2: "success",
  3: "error",
  4: "warning",
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function stripHtml(value?: string | null) {
  if (!value) return "";
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent || div.innerText || "";
}

export function UserLookupPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [creatorForm] = Form.useForm<{ username: string }>();
  const [messagesForm] = Form.useForm<{ identifier: string; campaignId?: string }>();

  const creatorMutation = useMutation({
    mutationFn: fetchCreatorAuth,
    onError: (error: Error) => messageApi.error(error.message || "查询创作者申请记录失败"),
  });

  const messagesMutation = useMutation({
    mutationFn: fetchUserPrivateMessages,
    onError: (error: Error) => messageApi.error(error.message || "查询用户私信失败"),
  });

  const queryCreator = async () => {
    const values = await creatorForm.validateFields();
    const username = values.username.trim().replace(/^@+/, "");
    creatorMutation.mutate(username);
  };

  const queryMessages = async (page = 1) => {
    const values = await messagesForm.validateFields();
    messagesMutation.mutate({
      identifier: values.identifier.trim(),
      campaignId: values.campaignId?.trim(),
      page,
      limit: messagesMutation.data?.data.pagination.pageSize || 20,
    });
  };

  const creator = creatorMutation.data?.data;
  const messageData = messagesMutation.data?.data;

  return (
    <PermissionGuard permission={["messages", "vip-management"]}>
      {contextHolder}
      <PageSection
        title="用户查询"
        description="查询用户创作者申请记录，以及站内消息页面发送给该用户的私信。"
      >
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} xl={10}>
            <Card title="查询创作者申请记录" size="small">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  根据 Twitter username 查询 auth_creator 的上次申请时间与状态。状态：0 未认证、1 认证中、2 已认证、3 认证失败、4 认证撤销。
                </Typography.Text>
                <Form form={creatorForm} layout="vertical" onFinish={() => void queryCreator()}>
                  <Form.Item name="username" label="Twitter 用户名" rules={[{ required: true, message: "请输入 Twitter 用户名" }]}>
                    <Input.Search
                      allowClear
                      placeholder="例如 DaveyNFTsAI"
                      enterButton="查询"
                      loading={creatorMutation.isPending}
                      onSearch={() => void queryCreator()}
                    />
                  </Form.Item>
                </Form>

                {creator ? (
                  creator.authCreator ? (
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="用户名">@{creator.username}</Descriptions.Item>
                      <Descriptions.Item label="Twitter ID">
                        {creator.authCreator.twitterId || creator.twitterId || "-"}
                      </Descriptions.Item>
                      <Descriptions.Item label="认证状态">
                        <Tag color={CREATOR_STATUS_COLORS[creator.authCreator.status ?? -1] || "default"}>
                          {creator.authCreator.statusLabel}
                          {creator.authCreator.status == null ? "" : ` (${creator.authCreator.status})`}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="上次申请时间">
                        {formatDateTime(creator.authCreator.recordTime)}
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`@${creator.username || creator.requestedUsername} 暂无创作者申请记录`} />
                  )
                ) : null}
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card title="查询用户私信列表" size="small">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  查询“站内消息”页面批量发送给某个用户的私信，可按 Campaign ID 过滤。
                </Typography.Text>
                <Form form={messagesForm} layout="vertical" onFinish={() => void queryMessages(1)}>
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="identifier" label="用户标识" rules={[{ required: true, message: "请输入用户名 / Twitter ID / 用户 ID" }]}>
                        <Input placeholder="用户名、Twitter ID 或 XHuntUser ID" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="campaignId" label="Campaign ID（可选）">
                        <Input placeholder="例如 kol_report_20251023" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Form.Item label=" ">
                        <Button type="primary" icon={<SearchOutlined />} loading={messagesMutation.isPending} onClick={() => void queryMessages(1)} block>
                          查询
                        </Button>
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>

                {messageData?.user ? (
                  <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
                    <Descriptions.Item label="用户">@{messageData.user.username || "-"}</Descriptions.Item>
                    <Descriptions.Item label="Twitter ID">{messageData.user.twitterId || "-"}</Descriptions.Item>
                    <Descriptions.Item label="显示名">{messageData.user.displayName || "-"}</Descriptions.Item>
                    <Descriptions.Item label="私信数">{messageData.pagination.totalCount}</Descriptions.Item>
                  </Descriptions>
                ) : messageData ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该用户" />
                ) : null}

                <Table<UserPrivateMessageItem>
                  size="small"
                  rowKey="id"
                  loading={messagesMutation.isPending}
                  dataSource={messageData?.messages || []}
                  scroll={{ x: 980 }}
                  pagination={messageData ? {
                    current: messageData.pagination.currentPage,
                    pageSize: messageData.pagination.pageSize,
                    total: messageData.pagination.totalCount,
                    showTotal: (total) => `共 ${total} 条`,
                    onChange: (page) => void queryMessages(page),
                  } : false}
                  columns={[
                    { title: "Campaign ID", dataIndex: "campaignId", width: 180, render: (value) => value || "-" },
                    { title: "标题", dataIndex: "title", width: 220, ellipsis: true },
                    {
                      title: "内容",
                      dataIndex: "content",
                      width: 360,
                      ellipsis: true,
                      render: (value) => <Typography.Text title={stripHtml(value)}>{stripHtml(value) || "-"}</Typography.Text>,
                    },
                    { title: "已读", dataIndex: "isRead", width: 90, render: (value) => <Tag color={value ? "green" : "orange"}>{value ? "已读" : "未读"}</Tag> },
                    { title: "发送时间", dataIndex: "sentAt", width: 180, render: (value) => formatDateTime(value) },
                    { title: "展示时间", dataIndex: "displayAt", width: 180, render: (value) => formatDateTime(value) },
                  ]}
                />
              </Space>
            </Card>
          </Col>
        </Row>
      </PageSection>
    </PermissionGuard>
  );
}
