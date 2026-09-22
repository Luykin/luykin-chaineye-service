import { useState, type ReactNode } from "react";
import { Avatar, Button, Card, Checkbox, Col, Collapse, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Spin, Statistic, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { InfoCircleOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { RichTitleEditor, isRichTitleEmpty, sanitizeRichTitleHtml } from "@/components/ui/RichTitleEditor";
import {
  createHotVoteTopic,
  deleteHotVoteAdminComment,
  deleteHotVoteAdminVote,
  fetchHotVoteAdminComments,
  fetchHotVoteAdminVotes,
  fetchHotVoteInternalTesters,
  fetchHotVoteTopics,
  updateHotVoteTopic,
  type HotVoteTopic,
  type HotVoteAdminComment,
  type HotVoteAdminVoteRecord,
} from "@/services/hot-vote";

const STATUS_OPTIONS = [
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "ended", label: "已结束" },
  { value: "archived", label: "已归档" },
];
const STATUS_TAG: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  published: { text: "已发布", color: "green" },
  ended: { text: "已结束", color: "orange" },
  archived: { text: "已归档", color: "default" },
};
const TOPIC_TYPE_OPTIONS = [
  { value: "person_pk", label: "人物 PK" },
  { value: "general_topic", label: "普通议题" },
];
const DOMAIN_OPTIONS = [
  { value: "web3", label: "Web3" },
  { value: "ai", label: "AI" },
];
const LANGUAGE_OPTIONS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

const OPTION_PALETTE = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#722ed1",
  "#13c2c2",
  "#eb2f96",
];

const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function InfoLabel({ label, info }: { label: ReactNode; info: string }) {
  return <Space size={5}>{label}<Tooltip title={info}><InfoCircleOutlined style={{ color: "#8c8c8c" }} /></Tooltip></Space>;
}

export function HotVotePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [testingFilter, setTestingFilter] = useState<string>();
  const [editing, setEditing] = useState<HotVoteTopic | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [contentLangTab, setContentLangTab] = useState<"zh" | "en">("zh");
  const [scheduleKey, setScheduleKey] = useState<string[]>([]);
  const [, forceUpdate] = useState({});
  const [form] = Form.useForm();

  const query = useQuery({
    queryKey: ["hot-vote-topics", page, pageSize, statusFilter, testingFilter],
    queryFn: () => fetchHotVoteTopics({ page, pageSize, status: statusFilter, testingPhase: testingFilter }),
  });
  const testersQuery = useQuery({
    queryKey: ["hot-vote-internal-testers"],
    queryFn: fetchHotVoteInternalTesters,
    enabled: editorOpen,
  });
  const refresh = () => void query.refetch();

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => editing ? updateHotVoteTopic(editing.id, values) : createHotVoteTopic(values),
    onSuccess: () => { messageApi.success("已保存"); setEditorOpen(false); setEditing(null); refresh(); },
    onError: (error: Error) => messageApi.error(error.message),
  });

  const openEdit = (item?: HotVoteTopic) => {
    setEditing(item || null);
    setEditorOpen(true);
    setContentLangTab("zh");
    if (item) {
      if (item.startTime || item.endTime || item.testingPhase || (item.testList && item.testList.length > 0)) {
        setScheduleKey(["schedule-and-testing"]);
      } else {
        setScheduleKey([]);
      }
      form.setFieldsValue({
        topicType: item.topicType || "person_pk",
        status: item.status || "draft",
        titleHtml: item.titleI18n?.zhHtml || item.titleHtml || item.title || "",
        titleHtmlEn: item.titleI18n?.enHtml || item.titleI18n?.en || "",
        summaryHtml: item.summaryI18n?.zhHtml || item.summaryHtml || item.summary || "",
        summaryHtmlEn: item.summaryI18n?.enHtml || item.summaryI18n?.en || "",
        options: (item.options || []).map((opt) => ({
          ...opt,
          nameEn: opt.nameI18n?.en || "",
          isGua: Boolean(opt.isGua),
        })),
        displayDomains: item.displayDomains || ["web3"],
        displayLanguages: item.displayLanguages || ["zh"],
        maxRevotes: item.maxRevotes ?? 2,
        sortWeight: item.sortWeight ?? 0,
        startTime: toLocalInput(item.startTime),
        endTime: toLocalInput(item.endTime),
        testingPhase: item.testingPhase ?? false,
        testList: item.testList || [],
      });
    } else {
      setScheduleKey([]);
      form.setFieldsValue({
        topicType: "person_pk",
        status: "draft",
        titleHtml: "",
        titleHtmlEn: "",
        summaryHtml: "",
        summaryHtmlEn: "",
        sortWeight: 0,
        maxRevotes: 2,
        testingPhase: false,
        displayDomains: ["web3"],
        displayLanguages: ["zh"],
        testList: [],
        options: [
          { id: "opt_1", name: "", nameEn: "", isGua: false },
          { id: "opt_2", name: "", nameEn: "", isGua: false },
          { id: "opt_gua", name: "吃个瓜", nameEn: "Just watching", isGua: true },
        ],
      });
    }
  };

  const handleGuaChange = (fieldIndex: number, checked: boolean) => {
    const currentOptions = form.getFieldValue("options") || [];
    const nextOptions = currentOptions.map((opt: Record<string, unknown>, idx: number) => {
      if (idx === fieldIndex) {
        return {
          ...opt,
          isGua: checked,
          name: checked && !opt.name ? "吃个瓜" : opt.name,
          nameEn: checked && !opt.nameEn ? "Just watching" : opt.nameEn,
          avatar: checked ? "" : opt.avatar,
          twitterHandle: checked ? "" : opt.twitterHandle,
        };
      }
      return checked ? { ...opt, isGua: false } : opt;
    });
    form.setFieldsValue({ options: nextOptions });
    forceUpdate({});
  };

  const submit = (values: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { ...values };

    const titleHtml = sanitizeRichTitleHtml((values.titleHtml as string) || "");
    const titleHtmlEn = sanitizeRichTitleHtml((values.titleHtmlEn as string) || "");
    const summaryHtml = sanitizeRichTitleHtml((values.summaryHtml as string) || "");
    const summaryHtmlEn = sanitizeRichTitleHtml((values.summaryHtmlEn as string) || "");

    payload.titleHtml = isRichTitleEmpty(titleHtml) ? "" : titleHtml;
    payload.titleHtmlEn = isRichTitleEmpty(titleHtmlEn) ? "" : titleHtmlEn;
    payload.summaryHtml = isRichTitleEmpty(summaryHtml) ? "" : summaryHtml;
    payload.summaryHtmlEn = isRichTitleEmpty(summaryHtmlEn) ? "" : summaryHtmlEn;

    const extractText = (html: string) =>
      html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
    payload.title = extractText(payload.titleHtml as string);
    payload.titleEn = extractText(payload.titleHtmlEn as string);
    payload.summary = extractText(payload.summaryHtml as string);
    payload.summaryEn = extractText(payload.summaryHtmlEn as string);

    payload.startTime = values.startTime ? new Date(String(values.startTime)).toISOString() : null;
    payload.endTime = values.endTime ? new Date(String(values.endTime)).toISOString() : null;

    if (Array.isArray(payload.options)) {
      let guaFound = false;
      payload.options = (payload.options as Array<Record<string, unknown>>).map((opt) => {
        const isGua = Boolean(opt.isGua) && !guaFound;
        if (isGua) guaFound = true;
        return {
          ...opt,
          isGua,
          avatar: isGua ? "" : opt.avatar || "",
          twitterHandle: isGua ? "" : opt.twitterHandle || "",
        };
      });
    }

    save.mutate(payload);
  };

  // 详情数据与留言管理弹窗
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [activeDetailTopic, setActiveDetailTopic] = useState<HotVoteTopic | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"votes" | "comments">("votes");
  const [commentPage, setCommentPage] = useState(1);
  const [commentPageSize, setCommentPageSize] = useState(10);
  const [commentStatusFilter, setCommentStatusFilter] = useState<string | undefined>(undefined);
  const [votePage, setVotePage] = useState(1);
  const [votePageSize, setVotePageSize] = useState(10);
  const [voteOptionFilter, setVoteOptionFilter] = useState<string | undefined>(undefined);

  const commentsQuery = useQuery({
    queryKey: ["hotVoteAdminComments", activeDetailTopic?.id, commentPage, commentPageSize, commentStatusFilter],
    queryFn: () =>
      activeDetailTopic
        ? fetchHotVoteAdminComments(activeDetailTopic.id, {
            page: commentPage,
            pageSize: commentPageSize,
            isDeleted: commentStatusFilter,
          })
        : Promise.reject(new Error("No topic")),
    enabled: detailModalOpen && !!activeDetailTopic && activeDetailTab === "comments",
  });

  const votesQuery = useQuery({
    queryKey: ["hotVoteAdminVotes", activeDetailTopic?.id, votePage, votePageSize, voteOptionFilter],
    queryFn: () =>
      activeDetailTopic
        ? fetchHotVoteAdminVotes(activeDetailTopic.id, {
            page: votePage,
            pageSize: votePageSize,
            optionId: voteOptionFilter,
          })
        : Promise.reject(new Error("No topic")),
    enabled: detailModalOpen && !!activeDetailTopic && activeDetailTab === "votes",
  });

  const deleteCommentMutation = useMutation({
    mutationFn: ({ commentId, hard }: { commentId: string; hard?: boolean }) =>
      activeDetailTopic
        ? deleteHotVoteAdminComment(activeDetailTopic.id, commentId, hard)
        : Promise.reject(new Error("No topic")),
    onSuccess: () => {
      messageApi.success("留言处理成功");
      void commentsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message),
  });

  const deleteVoteMutation = useMutation({
    mutationFn: (recordId: string) =>
      activeDetailTopic
        ? deleteHotVoteAdminVote(activeDetailTopic.id, recordId)
        : Promise.reject(new Error("No topic")),
    onSuccess: () => {
      messageApi.success("投票记录已删除，票数已重新计算");
      void votesQuery.refetch();
      refresh();
    },
    onError: (error: Error) => messageApi.error(error.message),
  });

  const openDetail = (item: HotVoteTopic, tab: "votes" | "comments" = "votes") => {
    setActiveDetailTopic(item);
    setActiveDetailTab(tab);
    setCommentPage(1);
    setVotePage(1);
    setDetailModalOpen(true);
  };

  const testerOptions = (testersQuery.data?.data || []).map((user) => ({ value: user.username, label: `@${user.username}` }));
  const topics = query.data?.data.list || [];
  const pagination = query.data?.data.pagination;

  const columns = [
    {
      title: "议题", key: "title", width: 260,
      render: (_: unknown, row: HotVoteTopic) => <>
        {row.titleHtml ? (
          <div style={{ marginBottom: 2 }}>
            <Tag color="blue" style={{ fontSize: 11, padding: "0 4px", lineHeight: "18px", marginRight: 4 }}>富文本</Tag>
            <span className="hot-vote-rich-title" dangerouslySetInnerHTML={{ __html: sanitizeRichTitleHtml(row.titleHtml) }} />
          </div>
        ) : (
          <Typography.Text strong>{row.title}</Typography.Text>
        )}
        {row.titleI18n?.en && <><br /><Typography.Text type="secondary" ellipsis={{ tooltip: row.titleI18n.en }}>{row.titleI18n.en}</Typography.Text></>}
        <br />
        <Typography.Text type="secondary" ellipsis={{ tooltip: row.summary }}>{row.summary}</Typography.Text>
      </>,
    },
    {
      title: "形式", dataIndex: "topicType", width: 90,
      render: (value: string) => <Tag color={value === "person_pk" ? "blue" : "purple"}>{value === "person_pk" ? "人物 PK" : "普通议题"}</Tag>,
    },
    {
      title: "状态", dataIndex: "status", width: 86,
      render: (value: string) => { const tag = STATUS_TAG[value] || { text: value, color: "default" }; return <Tag color={tag.color}>{tag.text}</Tag>; },
    },
    {
      title: "测试", dataIndex: "testingPhase", width: 76,
      render: (value: boolean, row: HotVoteTopic) => value ? <Tooltip title={(row.testList || []).map((item) => `@${item}`).join("、") || "未配置测试名单"}><Tag color="gold">内测中</Tag></Tooltip> : <Tag>正式</Tag>,
    },
    {
      title: "选项", dataIndex: "options", width: 200,
      render: (options: HotVoteTopic["options"]) => <Space size={4} wrap>{(options || []).map((opt) => <Tag key={opt.id} color={opt.isGua ? "default" : "cyan"}>{opt.name || opt.id}</Tag>)}</Space>,
    },
    {
      title: "可见范围", key: "display", width: 130,
      render: (_: unknown, row: HotVoteTopic) => <>
        <Typography.Text>{(row.displayDomains || []).map((d) => d === "web3" ? "Web3" : d === "ai" ? "AI" : d).join(" / ") || "-"}</Typography.Text>
        <br />
        <Typography.Text type="secondary">{(row.displayLanguages || []).map((l) => l === "zh" ? "中文" : l === "en" ? "EN" : l).join(" / ") || "-"}</Typography.Text>
      </>,
    },
    { title: "权重", dataIndex: "sortWeight", width: 64 },
    { title: "改票次数", dataIndex: "maxRevotes", width: 84 },
    {
      title: "时间", key: "time", width: 190,
      render: (_: unknown, row: HotVoteTopic) => <>
        {row.startTime ? new Date(row.startTime).toLocaleString() : "未设开始"}
        <br />
        {row.endTime ? `至 ${new Date(row.endTime).toLocaleString()}` : "未设结束"}
      </>,
    },
    {
      title: "创建时间", dataIndex: "createdAt", width: 165,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "操作", width: 145, fixed: "right" as const,
      render: (_: unknown, row: HotVoteTopic) => (
        <Space size={8}>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openDetail(row, "votes")}>
            数据/留言
          </Button>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  return <PermissionGuard permission="nacos_config"><PageSection title="热点投票" description="创建和维护 XHunt 热点投票议题：配置选项、可见领域与语言、内测名单和上下线状态。"><>{contextHolder}<Card title="议题列表" extra={<Space wrap>
    <Select allowClear placeholder="状态" style={{ width: 110 }} options={STATUS_OPTIONS} value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1); }} />
    <Select allowClear placeholder="测试阶段" style={{ width: 110 }} value={testingFilter} onChange={(value) => { setTestingFilter(value); setPage(1); }} options={[{ value: "true", label: "内测中" }, { value: "false", label: "正式" }]} />
    <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>新建议题</Button>
  </Space>}>
    {query.isLoading ? <div style={{ padding: 48, textAlign: "center" }}><Spin /></div> : <Table rowKey="id" size="small" columns={columns} dataSource={topics} scroll={{ x: 1450 }} pagination={{
      current: page,
      pageSize,
      total: pagination?.total || 0,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`,
      onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
    }} />}
  </Card>
  <Modal
    open={editorOpen}
    title={editing ? "编辑议题" : "新建议题"}
    width={860}
    onCancel={() => {
      setEditorOpen(false);
      setEditing(null);
    }}
    onOk={() => form.submit()}
    confirmLoading={save.isPending}
    destroyOnClose
  >
    <Form form={form} layout="vertical" onFinish={submit} size="middle">
      {/* 1. 核心属性：议题形式与发布状态并排紧凑 */}
      <Row gutter={12} style={{ marginBottom: 6 }}>
        <Col span={12}>
          <Form.Item
            name="topicType"
            label={<InfoLabel label="议题形式" info="人物 PK 强调双方对决；普通议题为一般观点投票。" />}
            rules={[{ required: true }]}
            style={{ marginBottom: 10 }}
          >
            <Select options={TOPIC_TYPE_OPTIONS} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="status"
            label={<InfoLabel label="议题状态" info="仅「已发布」的议题对用户可见；结束后不可再投票。" />}
            rules={[{ required: true }]}
            style={{ marginBottom: 10 }}
          >
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        </Col>
      </Row>

      {/* 2. 议题核心内容：仅包含标题与核心冲突介绍两个实体，中英文双语 Tabs */}
      <div style={{ marginBottom: 14 }}>
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) => {
            const hasEnConfig = !isRichTitleEmpty(getFieldValue("titleHtmlEn")) || !isRichTitleEmpty(getFieldValue("summaryHtmlEn"));
            return (
              <Tabs
                type="card"
                activeKey={contentLangTab}
                onChange={(key) => setContentLangTab(key as "zh" | "en")}
                items={[
                  {
                    key: "zh",
                    label: <span>🇨🇳 <b>中文内容</b>（必填）</span>,
                    children: (
                      <div style={{ padding: "4px 0" }}>
                        <Form.Item
                          name="titleHtml"
                          label={<InfoLabel label="议题标题" info="前台卡片主标题，支持文字加粗、斜体与代币图标。必填。" />}
                          rules={[
                            {
                              validator: async (_, value) => {
                                if (isRichTitleEmpty(value)) {
                                  throw new Error("请输入议题标题");
                                }
                              },
                            },
                          ]}
                          style={{ marginBottom: 12 }}
                        >
                          <RichTitleEditor
                            placeholder="输入中文议题标题，支持加粗、文字颜色、超链接与代币图标..."
                            minHeight={100}
                            maxLength={1000}
                          />
                        </Form.Item>

                        <Form.Item
                          name="summaryHtml"
                          label={<InfoLabel label="核心冲突介绍" info="一句话说明议题的核心冲突与争议背景，支持加粗、斜体与代币图标。必填。" />}
                          rules={[
                            {
                              validator: async (_, value) => {
                                if (isRichTitleEmpty(value)) {
                                  throw new Error("请输入核心冲突介绍");
                                }
                              },
                            },
                          ]}
                          style={{ marginBottom: 4 }}
                        >
                          <RichTitleEditor
                            placeholder="说明核心冲突与背景，支持多段落、引用、列表、超链接与配图..."
                            minHeight={180}
                            maxLength={4000}
                            allowNewline
                          />
                        </Form.Item>
                      </div>
                    ),
                  },
                  {
                    key: "en",
                    label: (
                      <Space size={6}>
                        <span>🌐 <b>英文内容</b> (English)</span>
                        {hasEnConfig && <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>已配置</Tag>}
                      </Space>
                    ),
                    children: (
                      <div style={{ padding: "4px 0" }}>
                        <div style={{ marginBottom: 10, padding: "6px 12px", background: "var(--admin-surface-soft, #f6f8fa)", borderRadius: 6, fontSize: 12, color: "#8c8c8c" }}>
                          💡 英文内容为选填项。若留空，英文前台界面将自动回退展示对应的中文标题与核心冲突介绍。
                        </div>

                        <Form.Item
                          name="titleHtmlEn"
                          label={<InfoLabel label="英文议题标题 (Title)" info="英文界面展示标题；留空则自动回退展示中文标题。" />}
                          style={{ marginBottom: 12 }}
                        >
                          <RichTitleEditor
                            placeholder="English debate title (optional)..."
                            minHeight={100}
                            maxLength={1000}
                          />
                        </Form.Item>

                        <Form.Item
                          name="summaryHtmlEn"
                          label={<InfoLabel label="英文核心冲突介绍 (Conflict Summary)" info="英文界面展示简介；留空则自动回退展示中文简介。" />}
                          style={{ marginBottom: 4 }}
                        >
                          <RichTitleEditor
                            placeholder="Conflict background and debate summary for English UI (optional)..."
                            minHeight={180}
                            maxLength={4000}
                            allowNewline
                          />
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            );
          }}
        </Form.Item>
      </div>

      {/* 3. 投票选项列表（去除颜色配置，吃瓜选项单选互斥，高度紧凑） */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <InfoLabel
          label={<span style={{ fontWeight: 600, fontSize: 13 }}>投票选项配置 (2 ~ 6 项)</span>}
          info="至少 2 个选项；ID 仅支持字母、数字、下划线和中划线。吃瓜选项只能同时有 1 个，无需配置推特 Handle 和头像。未设吃瓜选项时系统将自动追加。"
        />
      </div>

      <Form.Item
        name="options"
        style={{ marginBottom: 12 }}
        rules={[
          {
            validator: async (_, value) => {
              if (!Array.isArray(value) || value.length < 2) throw new Error("至少需要 2 个选项");
              if (value.length > 6) throw new Error("最多 6 个选项");
              const guaCount = value.filter((o) => o?.isGua).length;
              if (guaCount > 1) throw new Error("只能同时设置 1 个吃瓜选项");
            },
          },
        ]}
      >
        <Form.List name="options">
          {(fields, { add, remove }, { errors }) => (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {fields.map((field, idx) => {
                  const isGua = form.getFieldValue(["options", field.name, "isGua"]);
                  return (
                    <Card
                      key={field.key}
                      size="small"
                      className={isGua ? "hot-vote-gua-card" : ""}
                      style={{
                        border: isGua ? "1px dashed #d9d9d9" : "1px solid #f0f0f0",
                        background: isGua ? "var(--admin-surface-soft, #fafafa)" : "var(--admin-surface, #ffffff)",
                        borderRadius: 6,
                      }}
                      bodyStyle={{ padding: "8px 12px" }}
                    >
                      {/* 选项头部：选项编号/吃瓜标记 + 吃瓜互斥开关 + 删除 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <Space size={6}>
                          <Tag color={isGua ? "gold" : "blue"} style={{ fontWeight: 600, margin: 0 }}>
                            {isGua ? "🍉 吃瓜选项" : `选项 ${idx + 1}`}
                          </Tag>
                          {isGua && (
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              仅用于围观不表态，无需关联推特与头像
                            </Typography.Text>
                          )}
                        </Space>
                        <Space size={12}>
                          <Space size={4} style={{ fontSize: 12 }}>
                            <span style={{ color: isGua ? "#fa8c16" : "#8c8c8c" }}>吃瓜选项:</span>
                            <Switch
                              size="small"
                              checked={Boolean(isGua)}
                              onChange={(checked) => handleGuaChange(field.name, checked)}
                            />
                          </Space>
                          {fields.length > 2 && (
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<MinusCircleOutlined />}
                              onClick={() => remove(field.name)}
                              style={{ padding: "0 4px", fontSize: 12 }}
                            >
                              删除
                            </Button>
                          )}
                        </Space>
                      </div>

                      {/* 选项输入项：精简去除颜色配置 */}
                      <Row gutter={10}>
                        <Col xs={12} sm={6} md={5}>
                          <Form.Item
                            name={[field.name, "id"]}
                            label="选项 ID"
                            rules={[
                              { required: true, message: "必填" },
                              { pattern: /^[a-zA-Z0-9_-]{1,32}$/, message: "仅字母/数字/_/-" },
                            ]}
                            style={{ marginBottom: isGua ? 0 : 6 }}
                          >
                            <Input placeholder="如 opt_1" size="small" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={9} md={9}>
                          <Form.Item
                            name={[field.name, "name"]}
                            label="选项名称（中文）"
                            rules={[{ required: true, message: "必填" }, { max: 30 }]}
                            style={{ marginBottom: isGua ? 0 : 6 }}
                          >
                            <Input placeholder={isGua ? "吃个瓜" : "如 特朗普"} size="small" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={9} md={10}>
                          <Form.Item
                            name={[field.name, "nameEn"]}
                            label="选项名称（English，可选）"
                            rules={[{ max: 60 }]}
                            style={{ marginBottom: isGua ? 0 : 6 }}
                          >
                            <Input placeholder={isGua ? "Just watching" : "留空则英文版展示中文名"} size="small" />
                          </Form.Item>
                        </Col>

                        {!isGua && (
                          <>
                            <Col xs={24} sm={12} md={12}>
                              <Form.Item
                                name={[field.name, "twitterHandle"]}
                                label="X Handle（可选）"
                                style={{ marginBottom: 0 }}
                              >
                                <Input placeholder="推特用户名（不带 @），用于快捷跳转" allowClear size="small" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} sm={12} md={12}>
                              <Form.Item
                                name={[field.name, "avatar"]}
                                label="头像 URL（可选）"
                                style={{ marginBottom: 0 }}
                              >
                                <Input placeholder="https://...（留空自动使用 Handle 头像）" allowClear size="small" />
                              </Form.Item>
                            </Col>
                          </>
                        )}
                      </Row>
                    </Card>
                  );
                })}
              </div>
              <Form.ErrorList errors={errors} />
              {fields.length < 6 && (
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ id: `opt_${fields.length + 1}`, name: "", nameEn: "", isGua: false })}
                  size="small"
                  style={{ borderRadius: 6 }}
                >
                  添加选项 ({fields.length}/6)
                </Button>
              )}
            </>
          )}
        </Form.List>
      </Form.Item>

      {/* 4. 投放与交互规则：一行紧凑 4 栏 */}
      <Row gutter={12} style={{ marginBottom: 8 }}>
        <Col xs={12} sm={6}>
          <Form.Item
            name="displayDomains"
            label={<InfoLabel label="展示领域" info="议题在哪些领域站点可见。" />}
            rules={[{ required: true, message: "至少选择一项" }]}
            style={{ marginBottom: 8 }}
          >
            <Checkbox.Group options={DOMAIN_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6}>
          <Form.Item
            name="displayLanguages"
            label={<InfoLabel label="展示语言" info="议题在哪些语言版本可见。" />}
            rules={[{ required: true, message: "至少选择一项" }]}
            style={{ marginBottom: 8 }}
          >
            <Checkbox.Group options={LANGUAGE_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6}>
          <Form.Item
            name="maxRevotes"
            label={<InfoLabel label="允许改票次数" info="用户投票后允许修改选择的最大次数，0 为不可改票。" />}
            style={{ marginBottom: 8 }}
          >
            <InputNumber min={0} max={10} style={{ width: "100%" }} size="small" />
          </Form.Item>
        </Col>
        <Col xs={12} sm={6}>
          <Form.Item
            name="sortWeight"
            label={<InfoLabel label="排序权重" info="数值大者优先展示在前台。" />}
            style={{ marginBottom: 8 }}
          >
            <InputNumber style={{ width: "100%" }} size="small" />
          </Form.Item>
        </Col>
      </Row>

      {/* 5. 折叠面板：定时排期与定向内测设置（默认收起，有配置时自动展开） */}
      <Collapse
        className="hot-vote-form-collapse"
        activeKey={scheduleKey}
        onChange={(keys) => setScheduleKey(typeof keys === "string" ? [keys] : keys)}
        items={[
          {
            key: "schedule-and-testing",
            label: (
              <span style={{ fontSize: 13, fontWeight: 500, color: "#595959" }}>
                ⏱️ 定时排期与定向内测名单（高级设置）
              </span>
            ),
            children: (
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="startTime"
                    label={<InfoLabel label="开始时间" info="到达后开始展示/可投票；留空表示立即生效。" />}
                    style={{ marginBottom: 8 }}
                  >
                    <Input type="datetime-local" size="small" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="endTime"
                    label={<InfoLabel label="结束时间" info="到达后停止投票并展示最终结果；留空表示不限制。" />}
                    style={{ marginBottom: 8 }}
                  >
                    <Input type="datetime-local" size="small" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    name="testingPhase"
                    label={<InfoLabel label="内测阶段" info="开启后议题仅对内测名单中的用户可见。" />}
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch size="small" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={18}>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, next) => prev.testingPhase !== next.testingPhase}
                  >
                    {({ getFieldValue }) => (
                      <Form.Item
                        name="testList"
                        label={
                          <InfoLabel
                            label="内测白名单"
                            info="测试阶段可见本议题的 Twitter handle 名单；可从预设内测人员中选择，也可手动输入后回车。"
                          />
                        }
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          mode="tags"
                          showSearch
                          optionFilterProp="label"
                          options={testerOptions}
                          placeholder={
                            getFieldValue("testingPhase")
                              ? "选择或输入 Twitter handle（不带 @）"
                              : "未开启内测时无需配置"
                          }
                          loading={testersQuery.isFetching}
                          tokenSeparators={[",", "，", "\n", " "]}
                          size="small"
                        />
                      </Form.Item>
                    )}
                  </Form.Item>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </Form>
  </Modal>

  {/* 议题数据统计与留言管理弹窗 */}
  <Modal
    open={detailModalOpen}
    title={
      <Space>
        <span>议题详情与管理：</span>
        <Typography.Text strong style={{ color: "#1677ff" }}>
          {activeDetailTopic?.title}
        </Typography.Text>
      </Space>
    }
    width={980}
    footer={null}
    onCancel={() => {
      setDetailModalOpen(false);
      setActiveDetailTopic(null);
    }}
    destroyOnClose
  >
    <Tabs
      activeKey={activeDetailTab}
      onChange={(key) => setActiveDetailTab(key as "votes" | "comments")}
      items={[
        {
          key: "votes",
          label: `投票情况 (${votesQuery.data?.data?.summary?.totalParticipants ?? 0} 人参与)`,
          children: (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* 各选项票数分布汇总卡片 */}
              <Card size="small" title="投票分布概览" style={{ background: "var(--admin-surface-soft, #fafafa)" }}>
                <Row gutter={[16, 12]} align="middle">
                  <Col xs={24} md={6}>
                    <Statistic
                      title="总投票人数"
                      value={votesQuery.data?.data?.summary?.totalParticipants ?? 0}
                      suffix="人"
                    />
                  </Col>
                  <Col xs={24} md={18}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(votesQuery.data?.data?.summary?.distribution || []).map((opt, optIdx) => (
                        <div key={opt.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ width: 110, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {opt.name}
                          </span>
                          <Progress
                            percent={parseInt(opt.percentage || "0", 10)}
                            strokeColor={opt.isGua ? "#94a3b8" : OPTION_PALETTE[optIdx % OPTION_PALETTE.length]}
                            style={{ flex: 1, margin: 0 }}
                          />
                          <span style={{ width: 80, fontSize: 12, color: "#8c8c8c", textAlign: "right" }}>
                            {opt.count} 票 ({opt.percentage})
                          </span>
                        </div>
                      ))}
                    </div>
                  </Col>
                </Row>
              </Card>

              {/* 投票流水明细列表 */}
              <Card
                size="small"
                title="投票流水明细"
                extra={
                  <Space>
                    <Select
                      allowClear
                      placeholder="按选项筛选"
                      style={{ width: 130 }}
                      value={voteOptionFilter}
                      onChange={(val) => {
                        setVoteOptionFilter(val);
                        setVotePage(1);
                      }}
                      options={(activeDetailTopic?.options || []).map((o) => ({
                        value: o.id,
                        label: o.name || o.id,
                      }))}
                    />
                    <Button size="small" onClick={() => void votesQuery.refetch()}>
                      刷新
                    </Button>
                  </Space>
                }
              >
                <Table
                  rowKey="id"
                  size="small"
                  loading={votesQuery.isLoading}
                  dataSource={votesQuery.data?.data?.list || []}
                  pagination={{
                    current: votePage,
                    pageSize: votePageSize,
                    total: votesQuery.data?.data?.pagination?.total || 0,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条投票流水`,
                    onChange: (p, ps) => {
                      setVotePage(p);
                      setVotePageSize(ps);
                    },
                  }}
                  columns={[
                    {
                      title: "Twitter ID",
                      dataIndex: "twitterId",
                      width: 150,
                      render: (val: string) => (
                        <Typography.Text copyable={{ text: val }} code>
                          {val}
                        </Typography.Text>
                      ),
                    },
                    {
                      title: "支持选项",
                      dataIndex: "optionName",
                      width: 140,
                      render: (val: string) => <Tag color="blue">{val}</Tag>,
                    },
                    {
                      title: "投票形式",
                      dataIndex: "isAnonymous",
                      width: 100,
                      render: (val: boolean) =>
                        val ? <Tag color="default">匿名</Tag> : <Tag color="cyan">公开</Tag>,
                    },
                    {
                      title: "修改次数",
                      dataIndex: "revoteCount",
                      width: 90,
                    },
                    {
                      title: "IP",
                      dataIndex: "clientIp",
                      width: 130,
                      render: (val: string) => val || "-",
                    },
                    {
                      title: "投票时间",
                      dataIndex: "createdAt",
                      width: 160,
                      render: (val: string) => new Date(val).toLocaleString(),
                    },
                    {
                      title: "操作",
                      width: 90,
                      fixed: "right" as const,
                      render: (_: unknown, record: HotVoteAdminVoteRecord) => (
                        <Popconfirm
                          title="确定删除此投票记录？"
                          description="删除后票数将自动扣除并重新计算。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true, loading: deleteVoteMutation.isPending }}
                          onConfirm={() => deleteVoteMutation.mutate(record.id)}
                        >
                          <Button size="small" type="link" danger style={{ padding: 0 }}>
                            删除
                          </Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              </Card>
            </div>
          ),
        },
        {
          key: "comments",
          label: `留言管理 (${commentsQuery.data?.data?.pagination?.total ?? 0} 条)`,
          children: (
            <Card
              size="small"
              title="议题留言列表"
              extra={
                <Space>
                  <Select
                    allowClear
                    placeholder="状态"
                    style={{ width: 110 }}
                    value={commentStatusFilter}
                    onChange={(val) => {
                      setCommentStatusFilter(val);
                      setCommentPage(1);
                    }}
                    options={[
                      { value: "false", label: "正常可见" },
                      { value: "true", label: "已屏蔽" },
                    ]}
                  />
                  <Button size="small" onClick={() => void commentsQuery.refetch()}>
                    刷新
                  </Button>
                </Space>
              }
            >
              <Table
                rowKey="id"
                size="small"
                loading={commentsQuery.isLoading}
                dataSource={commentsQuery.data?.data?.list || []}
                pagination={{
                  current: commentPage,
                  pageSize: commentPageSize,
                  total: commentsQuery.data?.data?.pagination?.total || 0,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条留言`,
                  onChange: (p, ps) => {
                    setCommentPage(p);
                    setCommentPageSize(ps);
                  },
                }}
                columns={[
                  {
                    title: "留言用户",
                    width: 220,
                    render: (_: unknown, record: HotVoteAdminComment) => (
                      <Space align="start" size={8}>
                        <Avatar src={record.userAvatar || undefined} size={32}>{(record.displayName || record.userName || "U")[0]}</Avatar>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.2 }}>
                            @{record.userName}
                          </div>
                          {record.displayName && (
                            <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                              {record.displayName}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: "#bfbfbf", fontFamily: "monospace" }}>
                            ID: {record.twitterId}
                          </div>
                        </div>
                      </Space>
                    ),
                  },
                  {
                    title: "留言内容",
                    dataIndex: "content",
                    render: (text: string) => (
                      <Typography.Paragraph
                        ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
                        style={{ margin: 0, wordBreak: "break-word" }}
                      >
                        {text}
                      </Typography.Paragraph>
                    ),
                  },
                  {
                    title: "类型",
                    dataIndex: "isAnonymous",
                    width: 90,
                    render: (val: boolean) =>
                      val ? <Tag color="default">匿名</Tag> : <Tag color="blue">公开</Tag>,
                  },
                  {
                    title: "状态",
                    dataIndex: "isDeleted",
                    width: 90,
                    render: (val: boolean) =>
                      val ? <Tag color="error">已屏蔽</Tag> : <Tag color="success">正常</Tag>,
                  },
                  {
                    title: "发表时间",
                    dataIndex: "createdAt",
                    width: 155,
                    render: (val: string) => new Date(val).toLocaleString(),
                  },
                  {
                    title: "操作",
                    width: 130,
                    fixed: "right" as const,
                    render: (_: unknown, record: HotVoteAdminComment) => (
                      <Space size={4}>
                        {!record.isDeleted && (
                          <Popconfirm
                            title="确定屏蔽此留言？"
                            description="屏蔽后前台用户将无法看到该观点。"
                            okText="屏蔽"
                            cancelText="取消"
                            okButtonProps={{ danger: true, loading: deleteCommentMutation.isPending }}
                            onConfirm={() => deleteCommentMutation.mutate({ commentId: record.id, hard: false })}
                          >
                            <Button size="small" type="link" danger style={{ padding: 0 }}>
                              屏蔽
                            </Button>
                          </Popconfirm>
                        )}
                        <Popconfirm
                          title="彻底删除此留言？"
                          description="此操作将从数据库彻底物理删除，不可恢复。"
                          okText="彻底删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true, loading: deleteCommentMutation.isPending }}
                          onConfirm={() => deleteCommentMutation.mutate({ commentId: record.id, hard: true })}
                        >
                          <Button size="small" type="text" danger style={{ fontSize: 12, padding: "0 4px" }}>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ),
        },
      ]}
    />
  </Modal>
</></PageSection></PermissionGuard>;
}
