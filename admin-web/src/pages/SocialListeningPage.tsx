import { useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  ColorPicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
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
const { TextArea } = Input;

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

const FOLLOW_SOURCE_OPTIONS = [
  { value: "twitter_user_follow", label: "dev.twitter_user_follow" },
  { value: "twitter_user_unfollow", label: "dev.twitter_user_unfollow" },
  { value: "project_follow", label: "dev.project_follow" },
];

const PROCESS_STEPS = [
  {
    title: "1. 生成任务",
    table: "EchohuntSocialListeningJobs",
    desc: "恢复/刷新/定时器会创建 pending 任务，记录 jobType、时间范围、触发人和 metadata。",
  },
  {
    title: "2. 拆窗口扫描",
    table: "dev.tweet → EchohuntSocialListeningPosts",
    desc: "按 60 分钟窗口读取提及、引用、回复及关键词命中的推文，写入帖子事实表。",
  },
  {
    title: "3. 内容 AI",
    table: "EchohuntSocialListeningPosts",
    desc: "生成 topics、keywords、summaryZh、summaryEn，并更新 tagStatus/summaryStatus。",
  },
  {
    title: "4. 项目态度 AI",
    table: "EchohuntSocialListeningPosts",
    desc: "判断推文对项目的 positive/neutral/negative，写入 score、sentiment、sentimentSummaryZh。",
  },
  {
    title: "5. 关系与预警",
    table: "EchohuntSocialListeningAccountSignals / Alerts",
    desc: "生成高影响账号动态、关注/取关信号、讨论量与负面占比预警。",
  },
  {
    title: "6. 聚合快照",
    table: "EchohuntSocialListeningSnapshots",
    desc: "刷新 24H/7D/30D 快照，前台看板读取趋势、词云、主题和预警汇总。",
  },
];

const FIELD_GUIDE = [
  { label: "官方 X Handle", table: "Boards.officialHandle / officialTwitterId", desc: "输入 handle 后解析 Twitter ID；后端用 officialTwitterId 作为账号唯一身份，handle 只作为展示与兜底去重。" },
  { label: "项目名称", table: "Boards.projectName", desc: "看板标题，也是项目态度 AI 识别“这个项目是谁”的默认名称。" },
  { label: "项目简介", table: "Boards.projectDescription", desc: "运营侧可补充项目背景；解析资料时会从官方 profile 自动带入。" },
  { label: "头像 URL", table: "Boards.projectAvatar", desc: "前台与后台列表头像展示；解析资料时会从官方 profile 自动带入。" },
  { label: "品牌色", table: "Boards.brandColor", desc: "前台看板主题色。这里使用前端选色器，保存十六进制色值，例如 #1677ff。" },
  { label: "关键词", table: "Boards.metadata.keywords", desc: "推文召回词，每行一个；会和官方 handle、项目名称合并后匹配 dev.tweet.text。" },
  { label: "别名", table: "Boards.metadata.aliases", desc: "项目常见别称、代币名、缩写；也会参与召回，适合写 ticker、旧品牌名。" },
  { label: "Token", table: "Boards.metadata.token", desc: "项目代币符号或合约简称，会追加到召回关键词里；不是 API 密钥。" },
  { label: "关注关系源", table: "Boards.metadata.followSources", desc: "说明关注/取关信号来自哪些来源表；实际匹配账号用 officialTwitterId，不需要额外填写项目 key。" },
  { label: "AI 项目名", table: "Boards.metadata.aiProjectName", desc: "覆盖项目态度 AI 中的 project 名称，适合项目名与品牌名/协议名不一致时使用。" },
  { label: "AI 提示语", table: "Boards.metadata.aiPrompts", desc: "把项目态度、标签、摘要的提示语保存为可配置文本，避免只依赖代码里的固定默认逻辑。" },
];

const POST_FIELD_GUIDE = [
  { field: "topics / keywords", desc: "内容 AI 生成主题标签与热词，保存到 EchohuntSocialListeningPosts.topics / keywords。" },
  { field: "summaryZh / summaryEn", desc: "推文中英文摘要，保存到 EchohuntSocialListeningPosts.summaryZh / summaryEn。" },
  { field: "projectAttitudeScore", desc: "项目态度分，保存到 EchohuntSocialListeningPosts.projectAttitudeScore / sentimentScore。" },
  { field: "sentiment", desc: "positive / neutral / negative / unknown，保存到 EchohuntSocialListeningPosts.sentiment。" },
  { field: "sentimentSummaryZh", desc: "态度判断原因，保存到 EchohuntSocialListeningPosts.sentimentSummaryZh。" },
  { field: "ai.*Status", desc: "标签、摘要、态度和总状态，保存到 tagStatus / summaryStatus / attitudeStatus / aiStatus。" },
];

const DEFAULT_AI_PROMPTS = {
  projectAttitude: "判断这条推文对 {project} 的态度。输入文本格式为 <<发布时间--推文正文>>。请输出 score、sentiment 和中文 summary/reason：score 为 0-10 分，低于 4 视为 negative，高于 6 视为 positive，其余为 neutral。",
  tweetTag: "从推文正文中抽取加密/AI/产品/市场相关主题标签和热词。请返回 topics/domain_tags 和 keywords/hot_tags，标签要短、可聚合、适合主题榜和词云。推文正文：{text}",
  tweetSummary: "请根据推文正文生成 {lang} 摘要，控制在 {words} 个词左右；如果有媒体链接可结合媒体语境，但不要编造未出现的信息。推文正文：{text}",
};

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
    partial: "warning",
    generated: "success",
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function jsonPreview(value: unknown) {
  if (!value) return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function boardFormInitialValues(board?: SocialListeningBoard | null) {
  const metadata = board?.metadata || {};
  const aiPrompts = asRecord(metadata.aiPrompts);
  return {
    officialHandle: board?.officialHandle || "",
    projectName: board?.projectName || "",
    projectDescription: board?.projectDescription || "",
    projectAvatar: board?.projectAvatar || "",
    brandColor: board?.brandColor || undefined,
    keywords: Array.isArray(metadata.keywords) ? metadata.keywords.join("\n") : "",
    aliases: Array.isArray(metadata.aliases) ? metadata.aliases.join("\n") : "",
    token: typeof metadata.token === "string" ? metadata.token : "",
    followSources: Array.isArray(metadata.followSources) ? metadata.followSources : ["twitter_user_follow", "twitter_user_unfollow", "project_follow"],
    aiProjectName: typeof metadata.aiProjectName === "string" ? metadata.aiProjectName : "",
    projectAttitudePrompt: getString(aiPrompts.projectAttitude) || DEFAULT_AI_PROMPTS.projectAttitude,
    tweetTagPrompt: getString(aiPrompts.tweetTag) || DEFAULT_AI_PROMPTS.tweetTag,
    tweetSummaryPrompt: getString(aiPrompts.tweetSummary) || DEFAULT_AI_PROMPTS.tweetSummary,
    allowUnresolved: false,
  };
}

function buildBoardPayload(values: Record<string, unknown>, resolved?: ResolvedTwitterAccount | null) {
  const aiPrompts = {
    projectAttitude: values.projectAttitudePrompt || null,
    tweetTag: values.tweetTagPrompt || null,
    tweetSummary: values.tweetSummaryPrompt || null,
  };
  const metadata = {
    token: values.token || null,
    followSources: values.followSources || [],
    aiProjectName: values.aiProjectName || null,
    aiPrompts,
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

function JobProgressView({ job }: { job: SocialListeningJob }) {
  const progress = asRecord(job.progress);
  const counters = asRecord(progress.counters);
  const windowIndex = Number(progress.windowIndex || 0);
  const windowTotal = Number(progress.windowTotal || 0);
  const percent = job.status === "succeeded"
    ? 100
    : windowTotal > 0
      ? Math.min(99, Math.round((windowIndex / windowTotal) * 100))
      : job.status === "running" ? 12 : 0;

  return (
    <Space direction="vertical" size={12} className="social-listening-full">
      <div className="social-listening-job-progress">
        <Progress percent={percent} status={job.status === "failed" ? "exception" : job.status === "succeeded" ? "success" : "active"} />
        <Space wrap>
          <Tag>窗口 {windowIndex || 0}/{windowTotal || 0}</Tag>
          <Tag color="blue">扫描 {getNumberFromRecord(counters, "scanned")}</Tag>
          <Tag color="green">入库 {getNumberFromRecord(counters, "upserted")}</Tag>
          <Tag color="purple">内容 AI {getNumberFromRecord(counters, "contentAiAnalyzed")}</Tag>
          <Tag color="cyan">态度 AI {getNumberFromRecord(counters, "aiAnalyzed")}</Tag>
          <Tag color="geekblue">Prompt 覆盖 {getNumberFromRecord(counters, "contentAiPromptOverrides") + getNumberFromRecord(counters, "aiPromptOverrides")}</Tag>
          <Tag color="gold">关系信号 {getNumberFromRecord(counters, "followSignals") + getNumberFromRecord(counters, "influentialSignals")}</Tag>
          <Tag color="orange">预警 {getNumberFromRecord(counters, "aggregateAlerts")}</Tag>
        </Space>
      </div>
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="任务 ID" span={2}><Text code>{job.id}</Text></Descriptions.Item>
        <Descriptions.Item label="处理范围">{formatDate(job.rangeStartAt)} → {formatDate(job.rangeEndAt)}</Descriptions.Item>
        <Descriptions.Item label="触发方">{job.triggeredBy || "system"}</Descriptions.Item>
        <Descriptions.Item label="开始时间">{formatDate(job.startedAt)}</Descriptions.Item>
        <Descriptions.Item label="结束时间">{formatDate(job.finishedAt)}</Descriptions.Item>
        <Descriptions.Item label="当前窗口" span={2}><Text code>{jsonPreview(progress.currentWindow)}</Text></Descriptions.Item>
        <Descriptions.Item label="progress JSON" span={2}><pre className="social-listening-json-block">{jsonPreview(job.progress)}</pre></Descriptions.Item>
        <Descriptions.Item label="metadata JSON" span={2}><pre className="social-listening-json-block">{jsonPreview(job.metadata)}</pre></Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

function WorkflowGuide() {
  return (
    <div className="social-listening-process-map">
      {PROCESS_STEPS.map((step) => (
        <Card key={step.title} size="small" className="social-listening-process-card">
          <Text strong>{step.title}</Text>
          <Text code>{step.table}</Text>
          <Paragraph type="secondary">{step.desc}</Paragraph>
        </Card>
      ))}
    </div>
  );
}

function ConfigGuide({ board }: { board?: SocialListeningBoard | null }) {
  const metadata = board?.metadata || {};
  return (
    <Space direction="vertical" size={12} className="social-listening-full">
      <Alert
        type="info"
        showIcon
        message="配置字段怎么影响任务"
        description="被监控账号的基础字段保存在 EchohuntSocialListeningBoards；运营配置保存在 metadata。任务执行时会用 keywords/aliases/token 召回推文，用 AI 项目名和提示语指导后续 AI 处理。"
      />
      <Table
        rowKey="label"
        size="small"
        pagination={false}
        dataSource={FIELD_GUIDE}
        columns={[
          { title: "字段", dataIndex: "label", width: 160, render: (value) => <Text strong>{value}</Text> },
          { title: "保存位置", dataIndex: "table", width: 260, render: (value) => <Text code>{value}</Text> },
          { title: "用途", dataIndex: "desc" },
        ]}
      />
      {board ? (
        <Descriptions title="当前看板配置快照" size="small" bordered column={2}>
          <Descriptions.Item label="Token">{getString(metadata.token) || "-"}</Descriptions.Item>
          <Descriptions.Item label="官方 Twitter ID">{board.officialTwitterId || "未解析"}</Descriptions.Item>
          <Descriptions.Item label="关注关系源" span={2}>{Array.isArray(metadata.followSources) ? metadata.followSources.join("、") : "-"}</Descriptions.Item>
          <Descriptions.Item label="AI 项目名" span={2}>{getString(metadata.aiProjectName) || board.projectName}</Descriptions.Item>
          <Descriptions.Item label="AI Prompts" span={2}><pre className="social-listening-json-block">{jsonPreview(metadata.aiPrompts)}</pre></Descriptions.Item>
        </Descriptions>
      ) : null}
    </Space>
  );
}

function PostAiInspector({ post }: { post: SocialListeningPost }) {
  const row = post as SocialListeningPost & Record<string, unknown>;
  const ai = asRecord(row.ai);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Descriptions size="small" bordered column={2}>
          <Descriptions.Item label="保存表" span={2}><Text code>EchohuntSocialListeningPosts</Text></Descriptions.Item>
          <Descriptions.Item label="tweetId"><Text code>{post.tweetId}</Text></Descriptions.Item>
          <Descriptions.Item label="source">{post.source}</Descriptions.Item>
          <Descriptions.Item label="topics" span={2}>{Array.isArray(row.topics) && row.topics.length ? row.topics.map((item) => <Tag key={String(item)}>{String(item)}</Tag>) : "-"}</Descriptions.Item>
          <Descriptions.Item label="keywords" span={2}>{Array.isArray(row.keywords) && row.keywords.length ? row.keywords.map((item) => <Tag key={String(item)} color="blue">{String(item)}</Tag>) : "-"}</Descriptions.Item>
          <Descriptions.Item label="summaryZh" span={2}>{getString(row.summaryZh) || "-"}</Descriptions.Item>
          <Descriptions.Item label="summaryEn" span={2}>{getString(row.summaryEn) || "-"}</Descriptions.Item>
          <Descriptions.Item label="projectAttitudeScore">{row.projectAttitudeScore === null || row.projectAttitudeScore === undefined ? "-" : String(row.projectAttitudeScore)}</Descriptions.Item>
          <Descriptions.Item label="sentiment">{statusTag(post.sentiment)}</Descriptions.Item>
          <Descriptions.Item label="sentimentSummaryZh" span={2}>{getString(row.sentimentSummaryZh) || "-"}</Descriptions.Item>
          <Descriptions.Item label="AI 状态" span={2}>
            <Space wrap>
              <Tooltip title="EchohuntSocialListeningPosts.tagStatus"><span>{statusTag(getString(ai.tagStatus))}</span></Tooltip>
              <Tooltip title="EchohuntSocialListeningPosts.summaryStatus"><span>{statusTag(getString(ai.summaryStatus))}</span></Tooltip>
              <Tooltip title="EchohuntSocialListeningPosts.attitudeStatus"><span>{statusTag(getString(ai.attitudeStatus))}</span></Tooltip>
              <Tooltip title="EchohuntSocialListeningPosts.aiStatus"><span>{statusTag(getString(ai.aiStatus))}</span></Tooltip>
              <Tag>{getString(ai.aiSource) || "aiSource -"}</Tag>
              <Tag>{formatDate(getString(ai.aiAnalyzedAt))}</Tag>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Col>
      <Col xs={24} lg={10}>
        <Card size="small" title="这些字段从哪里来">
          <Timeline
            items={POST_FIELD_GUIDE.map((item) => ({
              children: <><Text strong>{item.field}</Text><Paragraph type="secondary">{item.desc}</Paragraph></>,
            }))}
          />
        </Card>
      </Col>
    </Row>
  );
}

function BoardFormGuide() {
  return (
    <Card size="small" className="social-listening-form-guide" title="字段教材">
      <Space direction="vertical" size={10}>
        {FIELD_GUIDE.map((item) => (
          <div key={item.label} className="social-listening-guide-item">
            <Text strong>{item.label}</Text>
            <Text type="secondary">{item.desc}</Text>
            <Text code>{item.table}</Text>
          </div>
        ))}
      </Space>
    </Card>
  );
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
    refetchInterval: open ? 15_000 : false,
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
    { title: "类型", dataIndex: "jobType", width: 150 },
    { title: "状态", dataIndex: "status", width: 100, render: statusTag },
    { title: "处理进度", width: 180, render: (_, row) => {
      const progress = asRecord(row.progress);
      const total = Number(progress.windowTotal || 0);
      const current = Number(progress.windowIndex || 0);
      return total ? `${current}/${total} 个窗口` : getString(progress.stage) || "-";
    } },
    { title: "写入结果", width: 280, render: (_, row) => {
      const counters = asRecord(asRecord(row.progress).counters);
      return <Space size={4} wrap><Tag>扫 {getNumberFromRecord(counters, "scanned")}</Tag><Tag color="green">入库 {getNumberFromRecord(counters, "upserted")}</Tag><Tag color="purple">AI {getNumberFromRecord(counters, "contentAiAnalyzed") + getNumberFromRecord(counters, "aiAnalyzed")}</Tag><Tag color="geekblue">Prompt {getNumberFromRecord(counters, "contentAiPromptOverrides") + getNumberFromRecord(counters, "aiPromptOverrides")}</Tag><Tag color="orange">预警 {getNumberFromRecord(counters, "aggregateAlerts")}</Tag></Space>;
    } },
    { title: "范围", width: 260, render: (_, row) => <Text type="secondary">{formatDate(row.rangeStartAt)} → {formatDate(row.rangeEndAt)}</Text> },
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
    { title: "AI 字段", width: 240, render: (_, row) => {
      const cast = row as SocialListeningPost & Record<string, unknown>;
      const ai = asRecord(cast.ai);
      return <Space size={4} wrap>{statusTag(getString(ai.tagStatus))}{statusTag(getString(ai.summaryStatus))}{statusTag(getString(ai.attitudeStatus))}</Space>;
    } },
    { title: "Views", width: 100, render: (_, row) => formatNumber(row.metrics.views) },
    { title: "发布时间", dataIndex: "postCreatedAt", width: 170, render: formatDate },
  ];

  return (
    <Drawer open={open} onClose={onClose} width="min(1280px, 96vw)" title={board ? `${board.projectName} / @${board.officialHandle}` : "Social Listening 看板"} destroyOnClose>
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
            <Descriptions.Item label="主表"><Text code>EchohuntSocialListeningBoards</Text></Descriptions.Item>
            <Descriptions.Item label="帖子表"><Text code>EchohuntSocialListeningPosts</Text></Descriptions.Item>
            <Descriptions.Item label="关键词" span={2}>{Array.isArray(board.metadata?.keywords) ? board.metadata.keywords.join("、") : "-"}</Descriptions.Item>
            {board.lastFailureReason ? <Descriptions.Item label="失败原因" span={2}><Text type="danger">{board.lastFailureReason}</Text></Descriptions.Item> : null}
          </Descriptions>
          <Tabs
            items={[
              {
                key: "workflow",
                label: "执行过程",
                children: <Space direction="vertical" size={12} className="social-listening-full"><WorkflowGuide /><Table rowKey="id" size="small" columns={jobColumns} dataSource={jobsQuery.data?.data.items || []} loading={jobsQuery.isFetching} pagination={false} scroll={{ x: 1280 }} expandable={{ expandedRowRender: (row) => <JobProgressView job={row} /> }} /></Space>,
              },
              {
                key: "posts",
                label: "推文字段追踪",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Alert type="info" showIcon message="展开每条推文，可以看到 AI 生成了哪些字段，以及这些字段保存在哪个表。" /><Space wrap><Select value={range} onChange={setRange} options={RANGE_OPTIONS} style={{ width: 100 }} /><Input.Search placeholder="搜索内容/作者" allowClear onSearch={(q) => setPostQuery((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={postQuery.sentiment} onChange={(sentiment) => setPostQuery((prev) => ({ ...prev, sentiment }))} style={{ width: 130 }} options={[{ value: "", label: "全部情绪" }, { value: "negative", label: "负面" }, { value: "neutral", label: "中性" }, { value: "positive", label: "正面" }, { value: "unknown", label: "未知" }]} /><Button icon={<DownloadOutlined />} onClick={() => window.open(buildSocialListeningExportUrl(board.id, { range, ...postQuery }), "_blank")}>导出</Button></Space><Table rowKey="id" size="small" columns={postColumns} dataSource={postsQuery.data?.data.items || []} loading={postsQuery.isFetching} pagination={false} scroll={{ x: 1180 }} expandable={{ expandedRowRender: (row) => <PostAiInspector post={row} /> }} /></Space>,
              },
              {
                key: "config",
                label: "配置说明",
                children: <ConfigGuide board={board} />,
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
                key: "access",
                label: "授权管理",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Form form={accessForm} layout="inline" onFinish={(values) => grantMutation.mutate(values)}><Form.Item name="twitterHandle" rules={[{ required: true, message: "请输入 X handle" }]}><Input placeholder="EchoHunt 用户 X handle" prefix="@" /></Form.Item><Form.Item name="twitterId"><Input placeholder="Twitter ID（可选）" /></Form.Item><Button type="primary" htmlType="submit" loading={grantMutation.isPending}>授权</Button></Form><Table rowKey="id" size="small" columns={accessColumns} dataSource={accessesQuery.data?.data.items || []} loading={accessesQuery.isFetching} pagination={false} scroll={{ x: 980 }} /></Space>,
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
    refetchInterval: 15_000,
  });
  const alertsQuery = useQuery({
    queryKey: ["social-listening", "alerts", "active"],
    queryFn: () => fetchSocialListeningAlerts({ status: "active", pageSize: 8 }),
  });

  const boards = boardsQuery.data?.data.items || [];
  const activeCount = boards.filter((item) => item.status === "monitoring").length;
  const failedCount = boards.filter((item) => item.status === "failed").length;
  const runningJobs = (jobsQuery.data?.data.items || []).filter((item) => ["pending", "running"].includes(item.status)).length;

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
    { title: "被监控账号", width: 260, render: (_, row) => <Space><Avatar src={row.projectAvatar || undefined} style={{ backgroundColor: row.brandColor || undefined }}>{row.projectName.slice(0, 1)}</Avatar><Space direction="vertical" size={0}><Text strong>{row.projectName}</Text><Text type="secondary">@{row.officialHandle}{row.verified ? <Tag color="blue" style={{ marginLeft: 6 }}>verified</Tag> : null}</Text></Space></Space> },
    { title: "状态", dataIndex: "status", width: 105, render: statusTag },
    { title: "粉丝/排名", width: 160, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatNumber(row.followersCount)}</Text><Text type="secondary">G {row.globalRank || "-"} · CN {row.cnRank || "-"}</Text></Space> },
    { title: "数据", width: 140, render: (_, row) => <Space direction="vertical" size={0}><Text>{row.postCount || 0} posts</Text><Text type="secondary">{row.accessCount || 0} accesses</Text></Space> },
    { title: "处理进度", width: 250, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatDate(row.processedThrough)}</Text><Text type={row.lastFailureReason ? "danger" : "secondary"}>{row.lastFailureReason || `最近成功 ${formatDate(row.lastSuccessAt)}`}</Text></Space> },
    { title: "最新任务", width: 190, render: (_, row) => row.latestJob ? <Space direction="vertical" size={0}>{statusTag(row.latestJob.status)}<Text type="secondary">{row.latestJob.jobType}</Text></Space> : "-" },
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
            <Paragraph type="secondary">维护被监控账号、配置 AI 提示语，并追踪后台采集任务、入库字段与预警异常。</Paragraph>
          </div>
          <Space wrap>
            <Card size="small"><Statistic title="看板数" value={boards.length} /></Card>
            <Card size="small"><Statistic title="监控中" value={activeCount} /></Card>
            <Card size="small"><Statistic title="运行中任务" value={runningJobs} /></Card>
            <Card size="small"><Statistic title="失败" value={failedCount} valueStyle={{ color: failedCount ? "#cf1322" : undefined }} /></Card>
          </Space>
        </div>

        <PageSection
          title="流程总览"
          description="搜索某个账号后点击「管理」，在「执行过程」里可以看每次定时任务扫描了哪些窗口、写入多少推文、AI 生成了哪些字段，以及这些字段保存在哪些表。"
        >
          <WorkflowGuide />
        </PageSection>

        <PageSection
          title="被监控账号"
          description="新增账号默认暂停，不会自动跑任务；管理员点击恢复后先补最近 7 天数据，再低优先级补齐 30 天，后续增量任务每 15 分钟由 jobs 进程推进。"
          extra={<Space wrap><Input.Search placeholder="搜索项目 / handle" allowClear onSearch={(q) => setFilters((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={filters.status} onChange={(status) => setFilters((prev) => ({ ...prev, status }))} options={STATUS_OPTIONS} style={{ width: 130 }} /><Button icon={<ReloadOutlined />} loading={boardsQuery.isFetching} onClick={() => boardsQuery.refetch()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增监控</Button></Space>}
        >
          <Table rowKey="id" size="small" columns={columns} dataSource={boards} loading={boardsQuery.isFetching} pagination={false} scroll={{ x: 1380 }} />
        </PageSection>

        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <PageSection title="最近任务" description="自动每 15 秒刷新；展开行可查看 counters、窗口游标和写表结果。">
              <Table<SocialListeningJob>
                rowKey="id"
                size="small"
                dataSource={jobsQuery.data?.data.items || []}
                loading={jobsQuery.isFetching}
                pagination={false}
                expandable={{ expandedRowRender: (row) => <JobProgressView job={row} /> }}
                columns={[
                  { title: "类型", dataIndex: "jobType" },
                  { title: "状态", dataIndex: "status", render: statusTag },
                  { title: "创建", dataIndex: "createdAt", render: formatDate },
                ]}
              />
            </PageSection>
          </Col>
          <Col xs={24} lg={12}>
            <PageSection title="活跃预警" description="聚合型预警会按小时去重合并。">
              <Table<SocialListeningAlert> rowKey="id" size="small" dataSource={alertsQuery.data?.data.items || []} loading={alertsQuery.isFetching} pagination={false} columns={[{ title: "级别", dataIndex: "severity", render: severityTag }, { title: "标题", dataIndex: "titleZh" }, { title: "时间", dataIndex: "triggeredAt", render: formatDate }]} />
            </PageSection>
          </Col>
        </Row>
      </Space>

      <Modal title={editingBoard ? "编辑被监控账号" : "新增被监控账号"} open={formOpen} onCancel={() => setFormOpen(false)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending} okText="保存配置" cancelText="取消" width={1120}>
        <Alert className="social-listening-modal-alert" type="info" showIcon message="新增后默认暂停" description="保存只写入配置，不会立刻跑任务。确认字段后，在列表点击「恢复」才会创建补数任务。" />
        <Row gutter={20} align="top">
          <Col xs={24} lg={15}>
            <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)} initialValues={boardFormInitialValues(editingBoard)}>
              <Space.Compact style={{ width: "100%" }}>
                <Form.Item name="officialHandle" label="官方 X Handle" rules={[{ required: true, message: "请输入官方 handle" }]} style={{ flex: 1 }} extra="被监控项目官方账号；保存到 Boards.officialHandle，新增后不可直接改。"><Input prefix="@" disabled={Boolean(editingBoard)} placeholder="例如 ethereum" /></Form.Item>
                <Form.Item label=" "><Button loading={resolveMutation.isPending} disabled={Boolean(editingBoard)} onClick={() => resolveMutation.mutate(form.getFieldValue("officialHandle"))}>解析资料</Button></Form.Item>
              </Space.Compact>
              {resolved ? <Card size="small" className="social-listening-resolved-card"><Space><Avatar src={resolved.avatar || undefined}>{(resolved.name || resolved.handle || "?").slice(0, 1)}</Avatar><Space direction="vertical" size={0}><Text strong>{resolved.name} @{resolved.handleLower || resolved.handle}</Text><Text type="secondary">粉丝 {formatNumber(resolved.followersCount)} · G {resolved.globalRank || "-"} · CN {resolved.cnRank || "-"}</Text></Space></Space></Card> : null}
              <Form.Item name="projectName" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]} extra="展示名称；也作为项目态度 AI 的默认 project 输入。"><Input placeholder="例如 Ethereum" /></Form.Item>
              <Form.Item name="projectDescription" label="项目简介" extra="项目背景快照，展示与后续 AI 理解都可参考。"><TextArea rows={2} placeholder="一句话说明项目定位、生态或核心产品" /></Form.Item>
              <Form.Item name="projectAvatar" label="头像 URL" extra="前台和后台头像展示；可以由解析资料自动带入，也可以手动覆盖。"><Input placeholder="https://..." /></Form.Item>
              <Form.Item name="brandColor" label="品牌色" extra="前台看板主题色；使用选色组件保存 #RRGGBB。" getValueFromEvent={(color, hex) => typeof hex === "string" ? hex : color?.toHexString?.()}>
                <ColorPicker showText format="hex" presets={[{ label: "常用", colors: ["#1677ff", "#16a34a", "#f97316", "#dc2626", "#7c3aed", "#0f172a"] }]} />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}><Form.Item name="keywords" label="关键词（每行一个）" extra="召回推文用；会匹配 dev.tweet.text，适合品牌名、协议名、产品名。"><TextArea rows={4} placeholder="Ethereum\nETH\nEVM" /></Form.Item></Col>
                <Col span={12}><Form.Item name="aliases" label="别名（每行一个）" extra="项目简称、旧名、ticker；会与关键词一起参与召回。"><TextArea rows={4} placeholder="Ether\n$ETH" /></Form.Item></Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}><Form.Item name="token" label="Token" extra="项目代币符号，会追加到召回关键词；不是 API token。"><Input placeholder="可选，例如 ETH" /></Form.Item></Col>
                <Col span={12}><Form.Item name="followSources" label="关注关系源" extra="关注/取关信号来源表。具体账号唯一身份使用解析得到的 officialTwitterId，不需要手填 project key。"><Select mode="multiple" options={FOLLOW_SOURCE_OPTIONS} placeholder="选择来源表" /></Form.Item></Col>
              </Row>
              <Collapse
                className="social-listening-ai-collapse"
                bordered={false}
                items={[
                  {
                    key: "ai-prompts",
                    label: "AI 提示语配置（默认折叠，通常不需要改）",
                    children: (
                      <>
                        <Alert className="social-listening-modal-alert" type="warning" showIcon message="提示语保存到 metadata.aiPrompts" description="输入框里已填当前兜底口径。你可以直接保存不改；如果需要调整 AI 判断标准，再展开修改。后端任务会把这里的文本作为 prompt/customPrompt/promptOverride 传给 AI 服务。" />
                        <Form.Item name="aiProjectName" label="AI 项目名" extra="覆盖项目态度 AI 的 project 名称；不填时使用项目名称。"><Input placeholder="默认使用项目名称" /></Form.Item>
                        <Form.Item name="projectAttitudePrompt" label="项目态度 Prompt" extra="默认对应 /ai/project_attitude：输入 text、project、lang=cn，要求输出 score、sentiment、summary/reason。"><TextArea rows={5} /></Form.Item>
                        <Form.Item name="tweetTagPrompt" label="推文标签 Prompt" extra="默认对应 /ai/tweet_tag_v2：根据 text 生成 topics/domain_tags 和 keywords/hot_tags。"><TextArea rows={5} /></Form.Item>
                        <Form.Item name="tweetSummaryPrompt" label="推文摘要 Prompt" extra="默认对应 /ai/tweet_summary_media：根据 text、lang、words、media 生成摘要。"><TextArea rows={5} /></Form.Item>
                      </>
                    ),
                  },
                ]}
              />
            </Form>
          </Col>
          <Col xs={24} lg={9}>
            <BoardFormGuide />
          </Col>
        </Row>
      </Modal>

      <BoardDrawer board={drawerBoard} open={Boolean(drawerBoard)} onClose={() => setDrawerBoard(null)} onChanged={() => { void boardsQuery.refetch(); void jobsQuery.refetch(); void alertsQuery.refetch(); }} />
    </PermissionGuard>
  );
}
