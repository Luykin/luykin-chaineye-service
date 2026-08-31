import { useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  type TableProps,
} from "antd";
import { DownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  buildSocialListeningExportUrl,
  createSocialListeningBoard,
  deleteSocialListeningBoard,
  fetchSocialListeningAccesses,
  fetchSocialListeningAlerts,
  fetchSocialListeningBoards,
  fetchSocialListeningJobs,
  fetchSocialListeningPosts,
  fetchSocialListeningSignals,
  grantSocialListeningAccess,
  pauseSocialListeningBoard,
  refreshSocialListeningBoard,
  resolveSocialListeningAccount,
  resumeSocialListeningBoard,
  retrySocialListeningJob,
  revokeSocialListeningAccess,
  updateSocialListeningBoard,
  type ResolvedTwitterAccount,
  type SocialListeningAccess,
  type SocialListeningAccountSignal,
  type SocialListeningAlert,
  type SocialListeningBoard,
  type SocialListeningJob,
  type SocialListeningPost,
} from "@/services/social-listening";

const { Text, Paragraph } = Typography;

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "initializing", label: "初始化" },
  { value: "monitoring", label: "监控中" },
  { value: "paused", label: "已暂停" },
  { value: "failed", label: "失败" },
  { value: "deleted", label: "已删除" },
];

const RANGE_OPTIONS = [
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
];

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return Intl.NumberFormat("zh-CN", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

function statusTag(status?: string) {
  const colorMap: Record<string, string> = {
    monitoring: "success",
    initializing: "processing",
    paused: "warning",
    failed: "error",
    deleted: "default",
    pending: "processing",
    running: "processing",
    succeeded: "success",
    skipped: "default",
    active: "success",
    revoked: "default",
  };
  return <Tag color={colorMap[status || ""] || "default"}>{status || "-"}</Tag>;
}

function severityTag(severity?: string) {
  const colorMap: Record<string, string> = { high: "red", medium: "orange", info: "blue" };
  return <Tag color={colorMap[severity || ""] || "default"}>{severity || "info"}</Tag>;
}

function splitTextarea(value?: string) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boardFormInitialValues(board?: SocialListeningBoard | null) {
  const metadata = board?.metadata || {};
  return {
    officialHandle: board?.officialHandle || "",
    projectName: board?.projectName || "",
    projectDescription: board?.projectDescription || "",
    projectAvatar: board?.projectAvatar || "",
    brandColor: board?.brandColor || "",
    keywords: Array.isArray(metadata.keywords) ? metadata.keywords.join("\n") : "",
    aliases: Array.isArray(metadata.aliases) ? metadata.aliases.join("\n") : "",
    token: typeof metadata.token === "string" ? metadata.token : "",
    followSources: Array.isArray(metadata.followSources) ? metadata.followSources : [],
    projectFollowKey: typeof metadata.projectFollowKey === "string" ? metadata.projectFollowKey : "",
    allowUnresolved: false,
  };
}

function buildBoardPayload(values: Record<string, unknown>, resolved?: ResolvedTwitterAccount | null) {
  const metadata = {
    token: values.token || null,
    followSources: values.followSources || [],
    projectFollowKey: values.projectFollowKey || null,
  };
  return {
    officialHandle: values.officialHandle,
    projectName: values.projectName,
    projectDescription: values.projectDescription || resolved?.description || null,
    projectAvatar: values.projectAvatar || resolved?.avatar || null,
    brandColor: values.brandColor || null,
    keywords: splitTextarea(String(values.keywords || "")),
    aliases: splitTextarea(String(values.aliases || "")),
    allowUnresolved: Boolean(values.allowUnresolved),
    metadata,
  };
}

interface BoardDrawerProps {
  board: SocialListeningBoard | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function BoardDrawer({ board, open, onClose, onChanged }: BoardDrawerProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [range, setRange] = useState("7D");
  const [accessForm] = Form.useForm();
  const [postQuery, setPostQuery] = useState({ q: "", sentiment: "", source: "", sort: "time_desc" });
  const boardId = board?.id || "";

  const accessesQuery = useQuery({
    queryKey: ["social-listening", "accesses", boardId],
    queryFn: () => fetchSocialListeningAccesses(boardId, { pageSize: 50 }),
    enabled: open && Boolean(boardId),
  });
  const jobsQuery = useQuery({
    queryKey: ["social-listening", "jobs", boardId],
    queryFn: () => fetchSocialListeningJobs({ boardId, pageSize: 20 }),
    enabled: open && Boolean(boardId),
  });
  const alertsQuery = useQuery({
    queryKey: ["social-listening", "alerts", boardId],
    queryFn: () => fetchSocialListeningAlerts({ boardId, pageSize: 20 }),
    enabled: open && Boolean(boardId),
  });
  const signalsQuery = useQuery({
    queryKey: ["social-listening", "signals", boardId, range],
    queryFn: () => fetchSocialListeningSignals(boardId, { range, pageSize: 20 }),
    enabled: open && Boolean(boardId),
  });
  const postsQuery = useQuery({
    queryKey: ["social-listening", "posts", boardId, range, postQuery],
    queryFn: () => fetchSocialListeningPosts(boardId, { range, pageSize: 20, ...postQuery }),
    enabled: open && Boolean(boardId),
  });

  const grantMutation = useMutation({
    mutationFn: (values: { twitterHandle: string; twitterId?: string }) => grantSocialListeningAccess(boardId, values),
    onSuccess: () => { messageApi.success("授权已生效"); accessForm.resetFields(); void accessesQuery.refetch(); onChanged(); },
    onError: (error: Error) => messageApi.error(error.message || "授权失败"),
  });
  const revokeMutation = useMutation({
    mutationFn: (accessId: string) => revokeSocialListeningAccess(boardId, accessId),
    onSuccess: () => { messageApi.success("授权已撤销"); void accessesQuery.refetch(); onChanged(); },
    onError: (error: Error) => messageApi.error(error.message || "撤销失败"),
  });
  const retryMutation = useMutation({
    mutationFn: retrySocialListeningJob,
    onSuccess: () => { messageApi.success("已创建重试任务"); void jobsQuery.refetch(); onChanged(); },
    onError: (error: Error) => messageApi.error(error.message || "重试失败"),
  });

  const accessColumns: TableProps<SocialListeningAccess>["columns"] = [
    { title: "X Handle", dataIndex: "twitterHandle", render: (value: string) => <Text strong>@{value}</Text> },
    { title: "Twitter ID", dataIndex: "twitterId", width: 170, render: (value?: string | null) => value || "-" },
    { title: "AuthCenter", dataIndex: "authCenterUserId", width: 240, ellipsis: true, render: (value?: string | null) => value || "未绑定" },
    { title: "状态", dataIndex: "status", width: 90, render: statusTag },
    { title: "授权时间", dataIndex: "grantedAt", width: 170, render: formatDate },
    { title: "操作", width: 90, render: (_, row) => row.status === "active" ? <Popconfirm title="撤销该账号访问权限？" okText="撤销" cancelText="取消" onConfirm={() => revokeMutation.mutate(row.id)}><Button size="small" danger>撤销</Button></Popconfirm> : null },
  ];

  const jobColumns: TableProps<SocialListeningJob>["columns"] = [
    { title: "类型", dataIndex: "jobType", width: 140 },
    { title: "状态", dataIndex: "status", width: 100, render: statusTag },
    { title: "范围", width: 260, render: (_, row) => <Text type="secondary">{formatDate(row.rangeStartAt)} → {formatDate(row.rangeEndAt)}</Text> },
    { title: "进度", dataIndex: "progress", ellipsis: true, render: (value) => value ? JSON.stringify(value) : "-" },
    { title: "错误", dataIndex: "errorMessage", ellipsis: true, render: (value?: string | null) => value || "-" },
    { title: "创建时间", dataIndex: "createdAt", width: 170, render: formatDate },
    { title: "操作", width: 80, render: (_, row) => row.status === "failed" ? <Button size="small" onClick={() => retryMutation.mutate(row.id)} loading={retryMutation.isPending}>重试</Button> : null },
  ];

  const alertColumns: TableProps<SocialListeningAlert>["columns"] = [
    { title: "级别", dataIndex: "severity", width: 90, render: severityTag },
    { title: "类型", dataIndex: "alertType", width: 170 },
    { title: "标题", dataIndex: "titleZh", width: 180, render: (value: string) => <Text strong>{value}</Text> },
    { title: "说明", dataIndex: "messageZh", ellipsis: true },
    { title: "触发时间", dataIndex: "triggeredAt", width: 170, render: formatDate },
  ];

  const signalColumns: TableProps<SocialListeningAccountSignal>["columns"] = [
    { title: "账号", width: 220, render: (_, row) => <Space><Avatar src={row.avatar || undefined}>{(row.handle || row.name || "?").slice(0, 1).toUpperCase()}</Avatar><Space direction="vertical" size={0}><Text strong>{row.name || row.handle}</Text><Text type="secondary">@{row.handle || row.twitterId}</Text></Space></Space> },
    { title: "类型", dataIndex: "signalType", width: 190 },
    { title: "排名", width: 140, render: (_, row) => <Space size={4} wrap>{row.globalRank ? <Tag>G {row.globalRank}</Tag> : null}{row.cnRank ? <Tag color="blue">CN {row.cnRank}</Tag> : null}</Space> },
    { title: "摘要", dataIndex: "summaryZh", ellipsis: true },
    { title: "发生时间", dataIndex: "occurredAt", width: 170, render: formatDate },
  ];

  const postColumns: TableProps<SocialListeningPost>["columns"] = [
    { title: "作者", width: 220, render: (_, row) => <Space><Avatar src={row.author.avatar || undefined}>{(row.author.handle || "?").slice(0, 1).toUpperCase()}</Avatar><Space direction="vertical" size={0}><Text strong>{row.author.name || row.author.handle}</Text><Text type="secondary">@{row.author.handle}</Text></Space></Space> },
    { title: "内容", dataIndex: "text", ellipsis: true, render: (value: string, row) => <a href={row.tweetUrl} target="_blank" rel="noreferrer">{value || row.tweetId}</a> },
    { title: "来源", dataIndex: "source", width: 90, render: (value: string) => <Tag>{value}</Tag> },
    { title: "情绪", dataIndex: "sentiment", width: 90, render: (value: string) => <Tag color={value === "negative" ? "red" : value === "positive" ? "green" : "default"}>{value}</Tag> },
    { title: "Views", width: 100, render: (_, row) => formatNumber(row.metrics.views) },
    { title: "发布时间", dataIndex: "postCreatedAt", width: 170, render: formatDate },
  ];

  return (
    <Drawer open={open} onClose={onClose} width="min(1180px, 96vw)" title={board ? `${board.projectName} / @${board.officialHandle}` : "Social Listening 看板"} destroyOnClose>
      {contextHolder}
      {board ? (
        <Space direction="vertical" size={16} className="social-listening-drawer">
          <Row gutter={12}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="授权账号" value={board.accessCount || 0} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="帖子入库" value={board.postCount || 0} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="粉丝数" value={board.followersCount || 0} formatter={(value) => formatNumber(Number(value))} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="华语排名" value={board.cnRank || "-"} /></Card></Col>
          </Row>
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="状态">{statusTag(board.status)}</Descriptions.Item>
            <Descriptions.Item label="最近成功">{formatDate(board.lastSuccessAt)}</Descriptions.Item>
            <Descriptions.Item label="覆盖开始">{formatDate(board.coverageStartAt)}</Descriptions.Item>
            <Descriptions.Item label="处理游标">{formatDate(board.processedThrough)}</Descriptions.Item>
            <Descriptions.Item label="关键词" span={2}>{Array.isArray(board.metadata?.keywords) ? board.metadata.keywords.join("、") : "-"}</Descriptions.Item>
            {board.lastFailureReason ? <Descriptions.Item label="失败原因" span={2}><Text type="danger">{board.lastFailureReason}</Text></Descriptions.Item> : null}
          </Descriptions>
          <Tabs
            items={[
              {
                key: "access",
                label: "授权管理",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Form form={accessForm} layout="inline" onFinish={(values) => grantMutation.mutate(values)}><Form.Item name="twitterHandle" rules={[{ required: true, message: "请输入 X handle" }]}><Input placeholder="EchoHunt 用户 X handle" prefix="@" /></Form.Item><Form.Item name="twitterId"><Input placeholder="Twitter ID（可选）" /></Form.Item><Button type="primary" htmlType="submit" loading={grantMutation.isPending}>授权</Button></Form><Table rowKey="id" size="small" columns={accessColumns} dataSource={accessesQuery.data?.data.items || []} loading={accessesQuery.isFetching} pagination={false} scroll={{ x: 980 }} /></Space>,
              },
              {
                key: "signals",
                label: "关键账号动态",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Select value={range} onChange={setRange} options={RANGE_OPTIONS} /><Table rowKey="id" size="small" columns={signalColumns} dataSource={signalsQuery.data?.data.items || []} loading={signalsQuery.isFetching} pagination={false} scroll={{ x: 960 }} /></Space>,
              },
              {
                key: "alerts",
                label: "异常/预警",
                children: <Table rowKey="id" size="small" columns={alertColumns} dataSource={alertsQuery.data?.data.items || []} loading={alertsQuery.isFetching} pagination={false} scroll={{ x: 980 }} />,
              },
              {
                key: "jobs",
                label: "任务状态",
                children: <Table rowKey="id" size="small" columns={jobColumns} dataSource={jobsQuery.data?.data.items || []} loading={jobsQuery.isFetching} pagination={false} scroll={{ x: 1100 }} />,
              },
              {
                key: "posts",
                label: "帖子排查",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Space wrap><Select value={range} onChange={setRange} options={RANGE_OPTIONS} style={{ width: 100 }} /><Input.Search placeholder="搜索内容/作者" allowClear onSearch={(q) => setPostQuery((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={postQuery.sentiment} onChange={(sentiment) => setPostQuery((prev) => ({ ...prev, sentiment }))} style={{ width: 130 }} options={[{ value: "", label: "全部情绪" }, { value: "negative", label: "负面" }, { value: "neutral", label: "中性" }, { value: "positive", label: "正面" }, { value: "unknown", label: "未知" }]} /><Button icon={<DownloadOutlined />} onClick={() => window.open(buildSocialListeningExportUrl(board.id, { range, ...postQuery }), "_blank")}>导出</Button></Space><Table rowKey="id" size="small" columns={postColumns} dataSource={postsQuery.data?.data.items || []} loading={postsQuery.isFetching} pagination={false} scroll={{ x: 980 }} /></Space>,
              },
            ]}
          />
        </Space>
      ) : <Empty />}
    </Drawer>
  );
}

export function SocialListeningPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [filters, setFilters] = useState({ q: "", status: "" });
  const [editingBoard, setEditingBoard] = useState<SocialListeningBoard | null>(null);
  const [drawerBoard, setDrawerBoard] = useState<SocialListeningBoard | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedTwitterAccount | null>(null);
  const [form] = Form.useForm();

  const boardsQuery = useQuery({
    queryKey: ["social-listening", "boards", filters],
    queryFn: () => fetchSocialListeningBoards({ pageSize: 50, ...filters }),
  });
  const jobsQuery = useQuery({
    queryKey: ["social-listening", "jobs", "recent"],
    queryFn: () => fetchSocialListeningJobs({ pageSize: 8 }),
  });
  const alertsQuery = useQuery({
    queryKey: ["social-listening", "alerts", "active"],
    queryFn: () => fetchSocialListeningAlerts({ status: "active", pageSize: 8 }),
  });

  const boards = boardsQuery.data?.data.items || [];
  const activeCount = boards.filter((item) => item.status === "monitoring").length;
  const failedCount = boards.filter((item) => item.status === "failed").length;

  const resolveMutation = useMutation({
    mutationFn: (handle: string) => resolveSocialListeningAccount(handle),
    onSuccess: (response) => {
      const account = response.data;
      setResolved(account);
      form.setFieldsValue({
        officialHandle: account.handleLower || account.handle || form.getFieldValue("officialHandle"),
        projectName: account.name || form.getFieldValue("projectName"),
        projectDescription: account.description || form.getFieldValue("projectDescription"),
        projectAvatar: account.avatar || form.getFieldValue("projectAvatar"),
      });
      messageApi.success("账号资料已解析");
    },
    onError: (error: Error) => messageApi.error(error.message || "解析失败"),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = buildBoardPayload(values, resolved);
      if (editingBoard) {
        await updateSocialListeningBoard(editingBoard.id, payload);
      } else {
        await createSocialListeningBoard(payload);
      }
      return true;
    },
    onSuccess: () => {
      messageApi.success(editingBoard ? "看板配置已更新" : "看板已创建，默认暂停；管理员点击恢复后才会启动任务");
      setFormOpen(false);
      setEditingBoard(null);
      setResolved(null);
      form.resetFields();
      void boardsQuery.refetch();
      void jobsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "保存失败"),
  });

  const refreshMutation = useMutation({
    mutationFn: refreshSocialListeningBoard,
    onSuccess: (response) => { messageApi.success(response.data.reused ? "已有任务运行中，已复用" : "刷新任务已创建"); void boardsQuery.refetch(); void jobsQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "刷新失败"),
  });
  const pauseMutation = useMutation({ mutationFn: pauseSocialListeningBoard, onSuccess: () => { messageApi.success("已暂停"); void boardsQuery.refetch(); }, onError: (error: Error) => messageApi.error(error.message || "暂停失败") });
  const resumeMutation = useMutation({ mutationFn: resumeSocialListeningBoard, onSuccess: () => { messageApi.success("已恢复并触发刷新"); void boardsQuery.refetch(); void jobsQuery.refetch(); }, onError: (error: Error) => messageApi.error(error.message || "恢复失败") });
  const deleteMutation = useMutation({ mutationFn: deleteSocialListeningBoard, onSuccess: () => { messageApi.success("已删除"); void boardsQuery.refetch(); }, onError: (error: Error) => messageApi.error(error.message || "删除失败") });

  function openCreate() {
    setEditingBoard(null);
    setResolved(null);
    form.setFieldsValue(boardFormInitialValues(null));
    setFormOpen(true);
  }

  function openEdit(board: SocialListeningBoard) {
    setEditingBoard(board);
    setResolved(null);
    form.setFieldsValue(boardFormInitialValues(board));
    setFormOpen(true);
  }

  const columns = useMemo<TableProps<SocialListeningBoard>["columns"]>(() => [
    { title: "被监控账号", width: 260, render: (_, row) => <Space><Avatar src={row.projectAvatar || undefined}>{row.projectName.slice(0, 1)}</Avatar><Space direction="vertical" size={0}><Text strong>{row.projectName}</Text><Text type="secondary">@{row.officialHandle}{row.verified ? <Tag color="blue" style={{ marginLeft: 6 }}>verified</Tag> : null}</Text></Space></Space> },
    { title: "状态", dataIndex: "status", width: 105, render: statusTag },
    { title: "粉丝/排名", width: 160, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatNumber(row.followersCount)}</Text><Text type="secondary">G {row.globalRank || "-"} · CN {row.cnRank || "-"}</Text></Space> },
    { title: "数据", width: 140, render: (_, row) => <Space direction="vertical" size={0}><Text>{row.postCount || 0} posts</Text><Text type="secondary">{row.accessCount || 0} accesses</Text></Space> },
    { title: "处理进度", width: 250, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatDate(row.processedThrough)}</Text><Text type={row.lastFailureReason ? "danger" : "secondary"}>{row.lastFailureReason || `最近成功 ${formatDate(row.lastSuccessAt)}`}</Text></Space> },
    { title: "最新任务", width: 170, render: (_, row) => row.latestJob ? <Space direction="vertical" size={0}>{statusTag(row.latestJob.status)}<Text type="secondary">{row.latestJob.jobType}</Text></Space> : "-" },
    { title: "操作", fixed: "right", width: 280, render: (_, row) => <Space size={6} wrap><Button size="small" onClick={() => setDrawerBoard(row)}>管理</Button><Button size="small" onClick={() => openEdit(row)}>编辑</Button><Button size="small" icon={<ThunderboltOutlined />} loading={refreshMutation.isPending} onClick={() => refreshMutation.mutate(row.id)}>刷新</Button>{row.status === "paused" ? <Button size="small" icon={<PlayCircleOutlined />} onClick={() => resumeMutation.mutate(row.id)}>恢复</Button> : <Button size="small" icon={<PauseCircleOutlined />} onClick={() => pauseMutation.mutate(row.id)}>暂停</Button>}<Popconfirm title="软删除该看板？" okText="删除" cancelText="取消" onConfirm={() => deleteMutation.mutate(row.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
  ], [deleteMutation, pauseMutation, refreshMutation, resumeMutation]);

  return (
    <PermissionGuard permission="social-listening">
      {contextHolder}
      <Space direction="vertical" size={16} className="social-listening-admin-page">
        <div className="social-listening-hero">
          <div>
            <Text className="social-listening-kicker">EchoHunt Ops</Text>
            <Typography.Title level={2}>Social Listening 管理台</Typography.Title>
            <Paragraph type="secondary">维护被监控账号、分配 EchoHunt 访问权限，并追踪后台采集任务与预警异常。</Paragraph>
          </div>
          <Space wrap>
            <Card size="small"><Statistic title="看板数" value={boards.length} /></Card>
            <Card size="small"><Statistic title="监控中" value={activeCount} /></Card>
            <Card size="small"><Statistic title="失败" value={failedCount} valueStyle={{ color: failedCount ? "#cf1322" : undefined }} /></Card>
          </Space>
        </div>

        <PageSection
          title="被监控账号"
          description="新增账号默认暂停，不会自动跑任务；管理员点击恢复后先补最近 7 天数据，再低优先级补齐 30 天，后续增量任务每 15 分钟由 jobs 进程推进。"
          extra={<Space wrap><Input.Search placeholder="搜索项目 / handle" allowClear onSearch={(q) => setFilters((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={filters.status} onChange={(status) => setFilters((prev) => ({ ...prev, status }))} options={STATUS_OPTIONS} style={{ width: 130 }} /><Button icon={<ReloadOutlined />} loading={boardsQuery.isFetching} onClick={() => boardsQuery.refetch()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增监控</Button></Space>}
        >
          <Table rowKey="id" size="small" columns={columns} dataSource={boards} loading={boardsQuery.isFetching} pagination={false} scroll={{ x: 1360 }} />
        </PageSection>

        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <PageSection title="最近任务" description="失败任务可进入看板管理抽屉重试。">
              <Table<SocialListeningJob> rowKey="id" size="small" dataSource={jobsQuery.data?.data.items || []} loading={jobsQuery.isFetching} pagination={false} columns={[{ title: "类型", dataIndex: "jobType" }, { title: "状态", dataIndex: "status", render: statusTag }, { title: "创建", dataIndex: "createdAt", render: formatDate }]} />
            </PageSection>
          </Col>
          <Col xs={24} lg={12}>
            <PageSection title="活跃预警" description="聚合型预警会按小时去重合并。">
              <Table<SocialListeningAlert> rowKey="id" size="small" dataSource={alertsQuery.data?.data.items || []} loading={alertsQuery.isFetching} pagination={false} columns={[{ title: "级别", dataIndex: "severity", render: severityTag }, { title: "标题", dataIndex: "titleZh" }, { title: "时间", dataIndex: "triggeredAt", render: formatDate }]} />
            </PageSection>
          </Col>
        </Row>
      </Space>

      <Modal title={editingBoard ? "编辑被监控账号" : "新增被监控账号"} open={formOpen} onCancel={() => setFormOpen(false)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending} okText="保存" cancelText="取消" width={760}>
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} initialValues={boardFormInitialValues(editingBoard)}>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="officialHandle" label="官方 X Handle" rules={[{ required: true, message: "请输入官方 handle" }]} style={{ flex: 1 }}><Input prefix="@" disabled={Boolean(editingBoard)} /></Form.Item>
            <Form.Item label=" "><Button loading={resolveMutation.isPending} disabled={Boolean(editingBoard)} onClick={() => resolveMutation.mutate(form.getFieldValue("officialHandle"))}>解析资料</Button></Form.Item>
          </Space.Compact>
          {resolved ? <Card size="small" className="social-listening-resolved-card"><Space><Avatar src={resolved.avatar || undefined}>{(resolved.name || resolved.handle || "?").slice(0, 1)}</Avatar><Space direction="vertical" size={0}><Text strong>{resolved.name} @{resolved.handleLower || resolved.handle}</Text><Text type="secondary">粉丝 {formatNumber(resolved.followersCount)} · G {resolved.globalRank || "-"} · CN {resolved.cnRank || "-"}</Text></Space></Space></Card> : null}
          <Form.Item name="projectName" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}><Input /></Form.Item>
          <Form.Item name="projectDescription" label="项目简介"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="projectAvatar" label="头像 URL"><Input /></Form.Item>
          <Form.Item name="brandColor" label="品牌色"><Input placeholder="#1677ff" /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="keywords" label="关键词（每行一个）"><Input.TextArea rows={4} /></Form.Item></Col>
            <Col span={12}><Form.Item name="aliases" label="别名（每行一个）"><Input.TextArea rows={4} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="token" label="Token"><Input placeholder="可选" /></Form.Item></Col>
            <Col span={8}><Form.Item name="projectFollowKey" label="project_follow key"><Input placeholder="可选" /></Form.Item></Col>
            <Col span={8}><Form.Item name="followSources" label="关注关系源"><Select mode="multiple" options={[{ value: "project_follow", label: "project_follow" }]} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <BoardDrawer board={drawerBoard} open={Boolean(drawerBoard)} onClose={() => setDrawerBoard(null)} onChanged={() => { void boardsQuery.refetch(); void jobsQuery.refetch(); void alertsQuery.refetch(); }} />
    </PermissionGuard>
  );
}
