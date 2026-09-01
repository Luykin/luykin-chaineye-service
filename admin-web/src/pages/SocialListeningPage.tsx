import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AutoComplete,
  Avatar,
  Button,
  Card,
  Col,
  Checkbox,
  Collapse,
  ColorPicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
  type AutoCompleteProps,
  type MenuProps,
  type TableProps,
} from "antd";
import { DeleteOutlined, DownloadOutlined, InfoCircleOutlined, MoreOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchVipLists } from "@/services/feature-flags";
import { fetchLlmModels, type LlmModelOption } from "@/services/llm";
import {
  buildSocialListeningExportUrl,
  createSocialListeningBoard,
  deleteSocialListeningBoard,
  fetchSocialListeningAccesses,
  fetchSocialListeningAlerts,
  fetchSocialListeningBoardAiConfig,
  fetchSocialListeningBoards,
  fetchSocialListeningJobs,
  fetchSocialListeningPosts,
  fetchSocialListeningRuntimeConfig,
  fetchSocialListeningAiWorkerStatus,
  fetchSocialListeningSignals,
  grantSocialListeningAccess,
  pauseSocialListeningAiWorker,
  pauseSocialListeningBoard,
  refreshSocialListeningBoard,
  resolveSocialListeningAccount,
  resumeSocialListeningAiWorker,
  resumeSocialListeningBoard,
  retrySocialListeningJob,
  revokeSocialListeningAccess,
  updateSocialListeningBoard,
  updateSocialListeningBoardAiConfig,
  updateSocialListeningRuntimeConfig,
  type ResolvedTwitterAccount,
  type SocialListeningAiRuntimeConfig,
  type SocialListeningAiWorkerConfig,
  type SocialListeningBoardAiRuntimeConfig,
  type SocialListeningAccess,
  type SocialListeningAccountSignal,
  type SocialListeningAlert,
  type SocialListeningBoard,
  type SocialListeningJob,
  type SocialListeningPost,
} from "@/services/social-listening";
import type { VipListItem } from "@/types/feature-flags";

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
  { field: "postZh / summaryZh / summaryEn", desc: "推文中文全文翻译 + 中英文摘要，保存到 EchohuntSocialListeningPosts.postZh / summaryZh / summaryEn。" },
  { field: "projectAttitudeScore", desc: "项目态度分，保存到 EchohuntSocialListeningPosts.projectAttitudeScore / sentimentScore。" },
  { field: "sentiment", desc: "positive / neutral / negative / unknown；无关、证据不足、无法可靠判断会写 unknown，不强行并入 neutral。" },
  { field: "sentimentSummaryZh", desc: "态度判断原因，保存到 EchohuntSocialListeningPosts.sentimentSummaryZh。" },
  { field: "ai.*Status", desc: "标签、摘要、态度和总状态，保存到 tagStatus / summaryStatus / attitudeStatus / aiStatus。" },
];

const DEFAULT_AI_PROMPTS = {
  "projectAttitude": "你是项目舆情分析助手。请判断下面推文对项目「{project}」的态度，按 project_attitude 兼容格式输出 JSON。\n\n输出字段：\n- score：范围 0-10；unknown 时为了兼容可给 5。\n- sentiment：必须从 positive、neutral、negative、unknown 中选择。\n- relevant_to_project：是否能确认推文在讨论项目「{project}」。\n- confidence：0-1，判断置信度。\n- summary：使用 {lang} 语言，简明说明判断依据。\n\n评分与归类规则：\n- 0-3.9：negative，负面/风险/批评/质疑/攻击/事故。\n- 4-6：neutral，仅用于确实相关但态度中性、客观新闻、没有明显倾向的内容。\n- 6.1-10：positive，正面/支持/认可/利好/合作/增长。\n- 如果推文只是提到项目且能确认相关但没有明显态度，sentiment=neutral，score 给 5 左右。\n- 如果推文和项目无关、证据不足、无法可靠判断是否在讨论项目或无法可靠判断态度，sentiment=unknown，relevant_to_project=false 或 confidence < 0.5；不要强行归入 neutral。\n\n推文：\n{text}",
  "tweetTag": "你是 Crypto/Web3/AI 社媒内容严格分类器。请分析下面推文，按 tweet_tag_v2_strict 兼容格式输出 JSON。\n\n硬性规则：\n1. crypto_relevant：是否和 Crypto/Web3/AI/金融科技/链上生态明显相关。\n2. domain_tag 必须且只能从以下集合选择：crypto、ai、科技、金融、内容创作、其他、抽奖。\n3. domain_tag_version 固定返回 tweet_tag_v2_domain_filter_v5。\n4. crypto_sub_tags 最多 8 个，只能从以下集合选择：DeFi、Layer1、Layer2、Meme、NFT、GameFi、DePIN、CeFi、Wallet、Stablecoin、RWA、Mining、Airdrop、Exchange、Infra、Security、DAO、Bridge、Derivatives、Lending、Staking、Oracle、Payment、Launchpad。\n5. ai_sub_tags 最多 8 个，只能从以下集合选择：LLM、Agent、Infra、Model、Data、App、Robotics、Inference、Training、Chip。\n6. hot_tags 最多 12 个，只能抽取推文原文中明确出现的项目名、代币名、协议名、产品名、叙事词；不要编造原文没出现过的词。\n7. tags 仅作兼容补充，必须少量、短词；如果不确定返回空数组。\n8. 不确定、无关或无法判断时：domain_tag 返回 其他，子标签和 hot_tags 返回空数组。\n9. 禁止输出上述集合外的 domain_tag / crypto_sub_tags / ai_sub_tags。\n\n推文：\n{text}",
  "tweetSummary": "你是社媒内容摘要助手。请基于下面推文生成一句 {lang} 摘要，尽量不超过 {words} 个词/中文短语，按 tweet_summary_media 兼容格式输出 JSON。\n\n要求：\n- 只保留核心事件、项目名、观点或动作。\n- 不添加推文没有的信息。\n- 如果媒体链接有助于理解，可以参考；无法访问媒体时忽略。\n- 当 {lang} 是 chinese 时，同时输出 post_zh：对推文原文做忠实中文全文翻译；不要摘要化、不要添加原文没有的信息。若原文已是中文，post_zh 返回原文清理后的中文内容。\n- 当 {lang} 不是 chinese 时，post_zh 可以为空字符串。\n\n推文：\n{text}\n\n媒体：\n{media}"
};

const LEGACY_FRONTEND_AI_PROMPTS = {
  "projectAttitude": "判断这条推文对 {project} 的态度。输入文本格式为 <<发布时间--推文正文>>。请输出 score、sentiment 和中文 summary/reason：score 为 0-10 分，低于 4 视为 negative，高于 6 视为 positive，其余为 neutral。",
  "tweetTag": "从推文正文中抽取加密/AI/产品/市场相关主题标签和热词。请返回 topics/domain_tags 和 keywords/hot_tags，标签要短、可聚合、适合主题榜和词云。推文正文：{text}",
  "tweetSummary": "请根据推文正文生成 {lang} 摘要，控制在 {words} 个词左右；如果有媒体链接可结合媒体语境，但不要编造未出现的信息。推文正文：{text}"
};

const EXTRA_LLM_MODEL_OPTIONS: LlmModelOption[] = [
  { value: "chatgpt/gpt-5.4-mini", label: "ChatGPT GPT-5.4 Mini" },
  { value: "chatgpt/gpt-5.6-luna", label: "ChatGPT GPT-5.6 Luna" },
];

const AI_RUNTIME_FIELD_HELP: Record<string, string> = {
  apiKey: "模型服务密钥。后台不会回显明文；保持不变时留空即可，选择替换时才填写新 Key。",
  baseURL: "OpenAI-compatible 接口地址，例如官方 OpenAI、Gemini 代理或内部网关，以 /v1 结尾更稳。",
  model: "默认模型。标签、摘要、态度三个专项模型为空时都会使用这个模型。",
  tweetTagModel: "只用于推文标签/热词生成；为空表示使用默认模型。",
  tweetSummaryModel: "只用于中文摘要和英文摘要；为空表示使用默认模型。",
  projectAttitudeModel: "只用于项目态度评分；为空表示使用默认模型。",
  contentEnabled: "开启后每条帖子最多 3 次调用：tweetTag、中文摘要、英文摘要。",
  projectAttitudeEnabled: "开启后每条帖子 1 次调用：输出 0-10 分、情绪和判断原因；无关/证据不足/无法可靠判断写 unknown。",
  contentBatchSize: "AI Worker 每轮每个账号最多处理多少条内容 AI；采集任务不再内联跑 AI。",
  projectAttitudeBatchSize: "AI Worker 每轮每个账号最多处理多少条态度 AI。",
  contentConcurrency: "内容 AI 并发帖子数；提高能加速，但会增加模型服务瞬时压力。",
  projectAttitudeConcurrency: "态度 AI 并发帖子数；提高能加速，但会增加模型服务瞬时压力。",
  maxTextLength: "进入 AI Prompt 前的推文硬截断字符数；超长推文会排在后面且记录 truncated=true。",
  negativeScoreThreshold: "态度分低于该值判定 negative；默认 4。",
  positiveScoreThreshold: "态度分高于该值判定 positive；中间区间判定 neutral；默认 6。",
  temperature: "模型随机性。分类/打分建议为 0，结果更稳定。",
  maxTokens: "默认输出 token 上限。专项上限未配置时使用这个值。",
  tweetTagMaxTokens: "标签/热词结构化输出上限。",
  tweetSummaryMaxTokens: "单次摘要输出上限；中英文摘要会分别调用。",
  projectAttitudeMaxTokens: "项目态度评分输出上限。",
  timeoutMs: "单次模型请求超时时间，单位毫秒。",
  maxRetries: "失败重试次数。过高会拖慢任务并可能增加调用次数。",
  summaryWords: "摘要 Prompt 中的目标摘要长度。",
  promptMaxLength: "全局/看板 Prompt 最大字符数，防止误填超长内容。",
  estimateInputPricePerMillion: "费用估算用的输入 token 单价，单位 USD / 100万 tokens；不影响真实调用。",
  estimateOutputPricePerMillion: "费用估算用的输出 token 单价，单位 USD / 100万 tokens；不影响真实调用。",
  estimateContentInputTokens: "估算内容分析单次调用平均输入 token，用于预算。",
  estimateContentOutputTokens: "估算内容分析单次调用平均输出 token，用于预算。",
  estimateProjectAttitudeInputTokens: "估算态度评价单次调用平均输入 token，用于预算。",
  estimateProjectAttitudeOutputTokens: "估算态度评价单次调用平均输出 token，用于预算。",
  prompts: "全局 Prompt 覆盖；看板详情里的看板级 Prompt 优先级更高。",
};

const AI_POST_PROCESSING_STEPS = [
  {
    key: "tweetTag",
    title: "1. 内容标签分析",
    trigger: "开启「内容分析」后执行",
    calls: "1 次 / 帖",
    model: "tweetTagModel；为空使用该账号模型",
    writes: [
      "topics：主题标签",
      "keywords：热词 + 召回命中关键词",
      "tagStatus：generated / skipped / failed",
      "rawTweet.socialListeningAi.tag：AI 原始结果和 promptTrace",
    ],
  },
  {
    key: "tweetSummary",
    title: "2. 中英文摘要",
    trigger: "开启「内容分析」后执行",
    calls: "2 次 / 帖（中文 1 次 + 英文 1 次）",
    model: "tweetSummaryModel；为空使用该账号模型",
    writes: [
      "postZh：中文全文翻译（仅中文摘要调用返回）",
      "summaryZh：中文摘要",
      "summaryEn：英文摘要",
      "summaryStatus：generated / skipped / failed",
      "rawTweet.socialListeningAi.summary：摘要结果和 promptTrace",
    ],
  },
  {
    key: "projectAttitude",
    title: "3. 项目态度评价",
    trigger: "开启「态度评价」后执行",
    calls: "1 次 / 帖",
    model: "projectAttitudeModel；为空使用该账号模型",
    writes: [
      "projectAttitudeScore：0-10 态度分",
      "sentimentScore：兼容分数字段，等同态度分",
      "sentiment：positive / neutral / negative / unknown（无法可靠判断为 unknown）",
      "sentimentSummaryZh：中文判断依据",
      "attitudeStatus：succeeded / failed / skipped",
      "rawTweet.projectAttitude：AI 原始结果和 promptTrace",
    ],
  },
];

function aiHelp(field: string) {
  return { title: AI_RUNTIME_FIELD_HELP[field] || "", icon: <InfoCircleOutlined /> };
}

function mergeModelOptions(models: LlmModelOption[] = []) {
  const seen = new Set<string>();
  return [...models, ...EXTRA_LLM_MODEL_OPTIONS]
    .filter((item) => {
      const value = String(item.value || "").trim();
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map((item) => ({ value: item.value, label: item.label || item.value }));
}

function filterModelOption(input: string, option?: { label?: unknown; value?: unknown }) {
  const keyword = input.toLowerCase();
  return String(option?.label || option?.value || "").toLowerCase().includes(keyword);
}

type ModelAutoCompleteProps = Omit<AutoCompleteProps, "options"> & {
  options: Array<{ value: string; label: string }>;
  placeholder: string;
};

function ModelAutoComplete({
  options,
  placeholder,
  ...props
}: ModelAutoCompleteProps) {
  return (
    <AutoComplete
      {...props}
      className="social-listening-model-autocomplete"
      allowClear
      placeholder={placeholder}
      options={options}
      filterOption={filterModelOption}
    />
  );
}

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

function formatUsd(value?: number | null) {
  const num = Number(value || 0);
  return `$${num.toFixed(num >= 10 ? 2 : 4)}`;
}

function formatEtaMinutes(value?: number | null) {
  const minutes = Math.max(0, Math.floor(Number(value || 0)));
  if (!minutes) return "已完成";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `约 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `约 ${hours} 小时 ${mins} 分钟`;
  return `约 ${mins} 分钟`;
}

function calculateAiCost(ai?: Partial<SocialListeningAiRuntimeConfig>, postCount = 0) {
  const posts = Math.max(0, Math.floor(Number(postCount || 0)));
  const contentCalls = ai?.contentEnabled ? 3 : 0;
  const attitudeCalls = ai?.projectAttitudeEnabled ? 1 : 0;
  const inputTokens = posts * (
    contentCalls * Number(ai?.estimateContentInputTokens || 1200)
    + attitudeCalls * Number(ai?.estimateProjectAttitudeInputTokens || 900)
  );
  const outputTokens = posts * (
    contentCalls * Number(ai?.estimateContentOutputTokens || 260)
    + attitudeCalls * Number(ai?.estimateProjectAttitudeOutputTokens || 180)
  );
  const estimatedUsd = (inputTokens / 1_000_000) * Number(ai?.estimateInputPricePerMillion || 0)
    + (outputTokens / 1_000_000) * Number(ai?.estimateOutputPricePerMillion || 0);
  return {
    posts,
    calls: posts * (contentCalls + attitudeCalls),
    inputTokens,
    outputTokens,
    estimatedUsd,
  };
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

function normalizeHandle(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

function normalizeHandleList(value: unknown) {
  const rawItems = Array.isArray(value) ? value : String(value || "").split(/[,\n\s]+/);
  return Array.from(new Set(rawItems.map(normalizeHandle).filter(Boolean)));
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

function getOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatRank(value: unknown) {
  const num = getOptionalNumber(value);
  if (num === null) return "-";
  return num > 0 ? `#${formatNumber(num)}` : "未上榜";
}

function renderTagList(value: unknown) {
  const list = Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!list.length) return "-";
  return <Space size={4} wrap>{list.map((item) => <Tag key={item}>{item}</Tag>)}</Space>;
}

function getBoardAiRuntimeFromMetadata(board?: SocialListeningBoard | null) {
  const metadata = asRecord(board?.metadata);
  return asRecord(metadata.aiRuntime);
}

function renderBoardAiStatus(board: SocialListeningBoard) {
  const aiRuntime = getBoardAiRuntimeFromMetadata(board);
  const contentOn = aiRuntime.contentEnabled === true;
  const attitudeOn = aiRuntime.projectAttitudeEnabled === true;
  const model = getString(aiRuntime.model);
  return (
    <Space direction="vertical" size={2}>
      <Space size={4} wrap>
        <Tag color={contentOn ? "green" : "default"}>内容 {contentOn ? "开" : "关"}</Tag>
        <Tag color={attitudeOn ? "green" : "default"}>态度 {attitudeOn ? "开" : "关"}</Tag>
      </Space>
      <Text type="secondary" ellipsis style={{ maxWidth: 160 }}>{model || "未选模型"}</Text>
    </Space>
  );
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

function normalizePromptForCompare(value: unknown) {
  return String(value || "").trim().replace(/\r\n/g, "\n");
}

function buildPromptOverride(value: unknown, key: keyof typeof DEFAULT_AI_PROMPTS) {
  const prompt = normalizePromptForCompare(value);
  if (!prompt) return null;
  if (prompt === normalizePromptForCompare(DEFAULT_AI_PROMPTS[key])) return null;
  if (prompt === normalizePromptForCompare(LEGACY_FRONTEND_AI_PROMPTS[key])) return null;
  return prompt;
}

function buildBoardPayload(values: Record<string, unknown>, resolved?: ResolvedTwitterAccount | null) {
  const aiPrompts = {
    projectAttitude: buildPromptOverride(values.projectAttitudePrompt, "projectAttitude"),
    tweetTag: buildPromptOverride(values.tweetTagPrompt, "tweetTag"),
    tweetSummary: buildPromptOverride(values.tweetSummaryPrompt, "tweetSummary"),
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

function BoardMetricCard({ title, value, hint, color }: { title: string; value: string | number; hint: string; color?: string }) {
  return (
    <Card size="small" className="social-listening-metric-card">
      <Statistic title={title} value={value} valueStyle={{ color }} />
      <Tooltip title={hint}>
        <Text type="secondary" className="social-listening-metric-hint" ellipsis>{hint}</Text>
      </Tooltip>
    </Card>
  );
}

function BoardOverview({ board }: { board: SocialListeningBoard }) {
  const metadata = board.metadata || {};
  const profileSnapshot = asRecord(metadata.profileSnapshot);
  const profile = asRecord(profileSnapshot.profile);
  const ai = asRecord(profileSnapshot.ai);
  const banner = getString(profile.profile_banner_url);
  const followingCount = getOptionalNumber(profile.following_count);
  const tweetsCount = getOptionalNumber(profile.tweets_count);
  const listedCount = getOptionalNumber(profile.listed_count);
  const isCn = ai.is_cn;
  const latestJob = board.latestJob;

  return (
    <Space direction="vertical" size={14} className="social-listening-full">
      <Card
        size="small"
        className="social-listening-board-profile"
        style={banner ? { backgroundImage: `linear-gradient(90deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.28)), url(${banner})` } : undefined}
      >
        <Space align="start" size={14} className="social-listening-full">
          <Avatar size={64} src={board.projectAvatar || undefined} style={{ backgroundColor: board.brandColor || undefined }}>{board.projectName.slice(0, 1)}</Avatar>
          <Space direction="vertical" size={6} className="social-listening-full">
            <Space size={8} wrap>
              <Text strong className="social-listening-board-title">{board.projectName}</Text>
              <Text type="secondary">@{board.officialHandle}</Text>
              {board.verified ? <Tag color="blue">X 认证</Tag> : <Tag>未认证</Tag>}
              {isCn === true ? <Tag color="geekblue">华语账号</Tag> : isCn === false ? <Tag>非华语账号</Tag> : null}
              {board.brandColor ? <Tag color={board.brandColor}>品牌色 {board.brandColor}</Tag> : null}
            </Space>
            <Paragraph className="social-listening-board-description">{board.projectDescription || "暂无项目简介；可在「编辑」里补充，方便运营识别和 AI 理解项目背景。"}</Paragraph>
            <Space size={6} wrap>
              <Text type="secondary">Twitter ID：</Text><Text code>{board.officialTwitterId || "-"}</Text>
              <Text type="secondary">资料快照：</Text><Text code>metadata.profileSnapshot</Text>
            </Space>
          </Space>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="粉丝数" value={formatNumber(board.followersCount)} hint="Boards.followersCount" /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="关注数" value={formatNumber(followingCount)} hint="dev.twitter_user.profile.following_count" /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="推文数" value={formatNumber(tweetsCount)} hint="profile.tweets_count" /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="Listed" value={formatNumber(listedCount)} hint="profile.listed_count" /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="全球排名" value={formatRank(board.globalRank)} hint="Boards.globalRank" color={board.globalRank && board.globalRank > 0 ? "#1677ff" : undefined} /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="华语排名" value={formatRank(board.cnRank)} hint="Boards.cnRank" color={board.cnRank && board.cnRank > 0 ? "#722ed1" : undefined} /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="帖子入库" value={board.postCount || 0} hint="SocialListeningPosts count" color="#16a34a" /></Col>
        <Col xs={12} md={6} xl={3}><BoardMetricCard title="授权账号" value={board.accessCount || 0} hint="BoardAccess active count" color="#f97316" /></Col>
      </Row>

      <Collapse
        className="social-listening-board-detail-collapse"
        bordered={false}
        items={[
          {
            key: "board-detail-fields",
            label: "账号详细字段",
            children: (
              <Descriptions size="small" bordered column={2}>
                <Descriptions.Item label="状态">{statusTag(board.status)}</Descriptions.Item>
                <Descriptions.Item label="认证状态">{board.verified ? <Tag color="blue">已认证</Tag> : <Tag>未认证 / 未知</Tag>}</Descriptions.Item>
                <Descriptions.Item label="官方 Handle">@{board.officialHandle}</Descriptions.Item>
                <Descriptions.Item label="官方 Twitter ID"><Text code>{board.officialTwitterId || "-"}</Text></Descriptions.Item>
                <Descriptions.Item label="全球排名">{formatRank(board.globalRank)}</Descriptions.Item>
                <Descriptions.Item label="华语排名">{formatRank(board.cnRank)}</Descriptions.Item>
                <Descriptions.Item label="关注数">{formatNumber(followingCount)}</Descriptions.Item>
                <Descriptions.Item label="推文数">{formatNumber(tweetsCount)}</Descriptions.Item>
                <Descriptions.Item label="Listed 数">{formatNumber(listedCount)}</Descriptions.Item>
                <Descriptions.Item label="语言识别">{isCn === true ? "华语" : isCn === false ? "非华语" : "-"}</Descriptions.Item>
                <Descriptions.Item label="覆盖开始">{formatDate(board.coverageStartAt)}</Descriptions.Item>
                <Descriptions.Item label="处理游标">{formatDate(board.processedThrough)}</Descriptions.Item>
                <Descriptions.Item label="最近成功">{formatDate(board.lastSuccessAt)}</Descriptions.Item>
                <Descriptions.Item label="最近失败">{formatDate(board.lastFailureAt)}</Descriptions.Item>
                <Descriptions.Item label="最新任务">{latestJob ? <Space size={4} wrap>{statusTag(latestJob.status)}<Tag>{latestJob.jobType}</Tag><Text type="secondary">{formatDate(latestJob.createdAt)}</Text></Space> : "-"}</Descriptions.Item>
                <Descriptions.Item label="排名来源">{getString(metadata.rankSource) || "-"}</Descriptions.Item>
                <Descriptions.Item label="Token">{getString(metadata.token) || "-"}</Descriptions.Item>
                <Descriptions.Item label="品牌色">{board.brandColor ? <Space size={6}><span className="social-listening-color-dot" style={{ background: board.brandColor }} /><Text code>{board.brandColor}</Text></Space> : "-"}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{formatDate(board.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="更新时间">{formatDate(board.updatedAt)}</Descriptions.Item>
                <Descriptions.Item label="创建管理员">{board.createdByAdminId || "-"}</Descriptions.Item>
                <Descriptions.Item label="更新管理员">{board.updatedByAdminId || "-"}</Descriptions.Item>
                <Descriptions.Item label="主表"><Text code>EchohuntSocialListeningBoards</Text></Descriptions.Item>
                <Descriptions.Item label="帖子表"><Text code>EchohuntSocialListeningPosts</Text></Descriptions.Item>
                <Descriptions.Item label="源资料表"><Text code>dev.twitter_user.profile / ai / feature / kol</Text></Descriptions.Item>
                <Descriptions.Item label="关系源表">{renderTagList(metadata.followSources)}</Descriptions.Item>
                <Descriptions.Item label="关键词" span={2}>{renderTagList(metadata.keywords)}</Descriptions.Item>
                <Descriptions.Item label="别名" span={2}>{renderTagList(metadata.aliases)}</Descriptions.Item>
                {board.lastFailureReason ? <Descriptions.Item label="失败原因" span={2}><Text type="danger">{board.lastFailureReason}</Text></Descriptions.Item> : null}
              </Descriptions>
            ),
          },
        ]}
      />
    </Space>
  );
}

function SignalInspector({ signal }: { signal: SocialListeningAccountSignal }) {
  const snapshot = asRecord(signal.rankSnapshot);
  const relation = asRecord(snapshot.relation);
  return (
    <Descriptions size="small" bordered column={2}>
      <Descriptions.Item label="Signal ID" span={2}><Text code>{signal.id}</Text></Descriptions.Item>
      <Descriptions.Item label="Twitter ID"><Text code>{signal.twitterId}</Text></Descriptions.Item>
      <Descriptions.Item label="账号">@{signal.handle || "-"}</Descriptions.Item>
      <Descriptions.Item label="粉丝数">{formatNumber(signal.followersCount)}</Descriptions.Item>
      <Descriptions.Item label="排名">G {formatRank(signal.globalRank)} / CN {formatRank(signal.cnRank)}</Descriptions.Item>
      <Descriptions.Item label="提及次数">{getOptionalNumber(signal.mentionCount) ?? 0}</Descriptions.Item>
      <Descriptions.Item label="曝光 / 互动">{formatNumber(signal.viewsCount)} / {formatNumber(signal.engagementCount)}</Descriptions.Item>
      <Descriptions.Item label="情绪">{signal.sentiment ? statusTag(signal.sentiment) : "-"}</Descriptions.Item>
      <Descriptions.Item label="发生时间">{formatDate(signal.occurredAt)}</Descriptions.Item>
      <Descriptions.Item label="来源表"><Text code>{getString(snapshot.sourceTable) || "-"}</Text></Descriptions.Item>
      <Descriptions.Item label="关系方向">{getString(snapshot.direction) || "-"}</Descriptions.Item>
      <Descriptions.Item label="follower_id"><Text code>{getString(relation.followerId) || "-"}</Text></Descriptions.Item>
      <Descriptions.Item label="following_id"><Text code>{getString(relation.followingId) || "-"}</Text></Descriptions.Item>
      <Descriptions.Item label="latest / persist">{getOptionalNumber(relation.latest) ?? "-"} / {getOptionalNumber(relation.persist) ?? "-"}</Descriptions.Item>
      <Descriptions.Item label="project key">{getString(snapshot.projectKey) || "-"}</Descriptions.Item>
      <Descriptions.Item label="主题" span={2}>{renderTagList(signal.topics)}</Descriptions.Item>
      <Descriptions.Item label="关联帖子" span={2}>{renderTagList(signal.postIds)}</Descriptions.Item>
      <Descriptions.Item label="rankSnapshot JSON" span={2}><pre className="social-listening-json-block">{jsonPreview(signal.rankSnapshot)}</pre></Descriptions.Item>
    </Descriptions>
  );
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
          <Tag color="default">候选页 {getNumberFromRecord(counters, "candidatePagesScanned") || "-"}</Tag>
          <Tag color="default">每页 {getNumberFromRecord(counters, "scanPageSize") || "-"}</Tag>
          <Tag color="default">候选行 {getNumberFromRecord(counters, "candidateRowsScanned")}</Tag>
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
          <Descriptions.Item label="postZh" span={2}>{getString(row.postZh) || "-"}</Descriptions.Item>
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

function AiPostProcessingGuide({ compact = false, defaultCollapsed = false }: { compact?: boolean; defaultCollapsed?: boolean }) {
  const content = (
    <>
      <Alert
        type="info"
        showIcon
        message="AI 分为两个开关：内容分析、态度评价"
        description="只开启内容分析时，每条帖子会做标签分析 + 中英文摘要；只开启态度评价时，只判断这条帖子对当前被监控项目的态度。两个都开启时，单条帖子最多 4 次 AI 调用。关闭账号 AI 后，后续任务会跳过该账号的 AI 阶段，历史 AI 字段不会自动清空。"
      />
      <Row gutter={[12, 12]} className="social-listening-ai-processing-steps">
        {AI_POST_PROCESSING_STEPS.map((step) => (
          <Col key={step.key} xs={24} lg={compact ? 24 : 8}>
            <Card size="small" className="social-listening-ai-processing-step" title={step.title}>
              <Space direction="vertical" size={8} className="social-listening-full">
                <Space size={6} wrap>
                  <Tag>{step.trigger}</Tag>
                  <Tag color="blue">{step.calls}</Tag>
                </Space>
                <Text type="secondary">{step.model}</Text>
                <div className="social-listening-ai-field-list">
                  {step.writes.map((item) => (
                    <Text key={item} code>{item}</Text>
                  ))}
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      <Descriptions size="small" bordered column={compact ? 1 : 2} className="social-listening-ai-common-fields">
        <Descriptions.Item label="公共状态字段">aiStatus、aiAnalyzedAt、aiError、aiSource</Descriptions.Item>
        <Descriptions.Item label="跳过规则">正文为空或过短会标记 skipped，不会强行调用模型</Descriptions.Item>
        <Descriptions.Item label="情绪阈值">score 小于负面阈值为 negative；大于正面阈值为 positive；中间为 neutral；无关/证据不足/低置信度为 unknown</Descriptions.Item>
        <Descriptions.Item label="保存表"><Text code>EchohuntSocialListeningPosts</Text></Descriptions.Item>
      </Descriptions>
    </>
  );

  if (defaultCollapsed) {
    return (
      <Collapse
        size="small"
        className="social-listening-ai-processing-guide"
        defaultActiveKey={[]}
        items={[
          {
            key: "ai-post-processing-guide",
            label: <Text strong>开启 AI 后，每个帖子会发生什么</Text>,
            extra: <Tag color="purple">最多 4 次调用 / 帖</Tag>,
            children: content,
          },
        ]}
      />
    );
  }

  return (
    <Card
      size="small"
      className="social-listening-ai-processing-guide"
      title="开启 AI 后，每个帖子会发生什么"
      extra={<Tag color="purple">最多 4 次调用 / 帖</Tag>}
    >
      {content}
    </Card>
  );
}

function AiRuntimeConfigPanel() {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const [estimatePosts, setEstimatePosts] = useState(10000);
  const configQuery = useQuery({
    queryKey: ["social-listening", "runtime-config"],
    queryFn: () => fetchSocialListeningRuntimeConfig({ estimatePosts }),
  });
  const aiWorkerQuery = useQuery({
    queryKey: ["social-listening", "ai-worker-status"],
    queryFn: fetchSocialListeningAiWorkerStatus,
    refetchInterval: 15_000,
  });
  const llmModelsQuery = useQuery({
    queryKey: ["llm-models"],
    queryFn: fetchLlmModels,
  });
  const modelOptions = useMemo(() => mergeModelOptions(llmModelsQuery.data?.data || []), [llmModelsQuery.data?.data]);
  const detail = configQuery.data?.data || null;
  const stats = detail?.stats;
  const aiWorkerStatus = aiWorkerQuery.data?.data || detail?.aiWorkerStatus || null;
  const watchedAi = Form.useWatch("ai", form) as Partial<SocialListeningAiRuntimeConfig> | undefined;
  const watchedApiKeyAction = Form.useWatch("apiKeyAction", form) as string | undefined;
  const liveEstimate = calculateAiCost(watchedAi || detail?.config.ai, estimatePosts);

  useEffect(() => {
    if (!detail?.config?.ai) return;
    form.setFieldsValue({
      apiKeyAction: "keep",
      ai: {
        ...detail.config.ai,
        apiKey: "",
        prompts: {
          projectAttitude: detail.config.ai.prompts?.projectAttitude || "",
          tweetTag: detail.config.ai.prompts?.tweetTag || "",
          tweetSummary: detail.config.ai.prompts?.tweetSummary || "",
        },
      },
      aiWorker: detail.config.aiWorker || detail.aiWorkerStatus?.config,
    });
    const pending = Math.max(detail.stats.contentPendingPosts || 0, detail.stats.projectAttitudePendingPosts || 0);
    if (pending > 10000) setEstimatePosts((prev) => Math.max(prev, pending));
  }, [detail, form]);


  const pauseAiWorkerMutation = useMutation({
    mutationFn: pauseSocialListeningAiWorker,
    onSuccess: () => {
      messageApi.success("AI Worker 已暂停");
      void aiWorkerQuery.refetch();
      void configQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "暂停 AI Worker 失败"),
  });
  const resumeAiWorkerMutation = useMutation({
    mutationFn: resumeSocialListeningAiWorker,
    onSuccess: () => {
      messageApi.success("AI Worker 已恢复");
      void aiWorkerQuery.refetch();
      void configQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "恢复 AI Worker 失败"),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue(true) as { apiKeyAction?: "keep" | "replace" | "clear"; ai?: Partial<SocialListeningAiRuntimeConfig>; aiWorker?: Partial<SocialListeningAiWorkerConfig> };
      return updateSocialListeningRuntimeConfig({
        apiKeyAction: values.apiKeyAction || "keep",
        ai: values.ai || {},
        aiWorker: values.aiWorker || {},
      });
    },
    onSuccess: () => {
      messageApi.success("AI 运行配置已发布到 Nacos，后端 1 分钟内会读到新配置");
      void configQuery.refetch();
      void aiWorkerQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "保存 AI 配置失败"),
  });

  return (
    <Space direction="vertical" size={12} className="social-listening-full social-listening-ai-runtime-panel">
      {contextHolder}
      {detail?.loadError ? <Alert type="warning" showIcon message="当前使用默认配置" description={detail.loadError} /> : null}
      <AiPostProcessingGuide />
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={6}>
          <Card size="small" title="状态与预算" extra={<Tag color={detail?.source === "nacos" ? "green" : "orange"}>{detail?.source === "nacos" ? "Nacos" : "默认"}</Tag>}>
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Row gutter={[8, 8]}>
                <Col span={12}><Statistic title="看板" value={stats?.boardCount || 0} /></Col>
                <Col span={12}><Statistic title="帖子" value={stats?.totalPosts || 0} /></Col>
                <Col span={12}><Statistic title="内容待分析" value={stats?.contentPendingPosts || 0} valueStyle={{ color: (stats?.contentPendingPosts || 0) ? "#d46b08" : undefined }} /></Col>
                <Col span={12}><Statistic title="态度待评价" value={stats?.projectAttitudePendingPosts || 0} valueStyle={{ color: (stats?.projectAttitudePendingPosts || 0) ? "#d46b08" : undefined }} /></Col>
              </Row>
              <Alert
                type={detail?.config.ai.apiKeyConfigured ? "success" : "warning"}
                showIcon
                message={detail?.config.ai.apiKeyConfigured ? `API Key 已配置：${detail.config.ai.apiKeyMasked}` : "API Key 未配置"}
              />
              <InputNumber min={0} value={estimatePosts} onChange={(value) => setEstimatePosts(Number(value || 0))} addonBefore="估算帖子" style={{ width: "100%" }} />
              <Row gutter={[8, 8]}>
                <Col span={12}><Statistic title="预计调用" value={liveEstimate.calls} suffix="次" /></Col>
                <Col span={12}><Statistic title="预计费用" value={formatUsd(liveEstimate.estimatedUsd)} /></Col>
              </Row>
              <Text type="secondary">这里是全局供应商和总闸；账号仍需单独开启。</Text>
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={18}>
          <Form form={form} layout="vertical" onFinish={() => updateMutation.mutate()}>
            <Card
              size="small"
              title="AI Worker（独立回填任务）"
              extra={<Space>
                {aiWorkerStatus?.enabled ? <Tag color="green">运行中</Tag> : <Tag color="orange">已暂停</Tag>}
                <Button size="small" icon={<ReloadOutlined />} loading={aiWorkerQuery.isFetching} onClick={() => aiWorkerQuery.refetch()}>刷新状态</Button>
                {aiWorkerStatus?.enabled ? (
                  <Button size="small" icon={<PauseCircleOutlined />} loading={pauseAiWorkerMutation.isPending} onClick={() => pauseAiWorkerMutation.mutate()}>暂停 AI</Button>
                ) : (
                  <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={resumeAiWorkerMutation.isPending} onClick={() => resumeAiWorkerMutation.mutate()}>恢复 AI</Button>
                )}
              </Space>}
            >
              <Alert
                type="info"
                showIcon
                message="AI 已从 15 分钟采集轮询拆出来"
                description="采集任务只负责入库/聚合；这里的 AI Worker 单独按自己的频率回填旧帖和新帖，可独立暂停。待处理队列按正文长度从短到长执行，超长推文会先硬截断。"
                style={{ marginBottom: 12 }}
              />
              <Row gutter={[12, 4]}>
                <Col xs={12} md={6}>
                  <Form.Item name={["aiWorker", "mode"]} label="Nacos 模式">
                    <Select options={[{ value: "enabled", label: "允许运行" }, { value: "disabled", label: "强制关闭" }]} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "tickIntervalMs"]} label="轮询间隔 ms"><InputNumber min={10000} max={300000} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "maxBoardsPerTick"]} label="每轮账号数"><InputNumber min={1} max={20} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "maxTextLength"]} label="推文截断字符"><InputNumber min={200} max={5000} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "contentBatchSize"]} label="内容批大小"><InputNumber min={1} max={500} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "projectAttitudeBatchSize"]} label="态度批大小"><InputNumber min={1} max={1000} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "contentConcurrency"]} label="内容并发"><InputNumber min={1} max={20} style={{ width: "100%" }} /></Form.Item></Col>
                <Col xs={12} md={6}><Form.Item name={["aiWorker", "projectAttitudeConcurrency"]} label="态度并发"><InputNumber min={1} max={20} style={{ width: "100%" }} /></Form.Item></Col>
              </Row>
              <Descriptions size="small" bordered column={2}>
                <Descriptions.Item label="Redis 状态">{aiWorkerStatus?.redisState || "-"}</Descriptions.Item>
                <Descriptions.Item label="上次运行">{formatDate(getString(asRecord(aiWorkerStatus?.lastRun).finishedAt))}</Descriptions.Item>
                <Descriptions.Item label="上次内容成功">{getNumberFromRecord(asRecord(aiWorkerStatus?.lastRun), "contentAnalyzed")}</Descriptions.Item>
                <Descriptions.Item label="上次态度成功">{getNumberFromRecord(asRecord(aiWorkerStatus?.lastRun), "attitudeAnalyzed")}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="基础配置" extra={<Button size="small" icon={<ReloadOutlined />} loading={configQuery.isFetching} onClick={() => configQuery.refetch()}>重新读取</Button>}>
              <Row gutter={[12, 4]}>
                <Col xs={24} md={8}>
                  <Form.Item name={["ai", "model"]} label="默认模型" tooltip={aiHelp("model")} rules={[{ required: true, message: "请输入默认模型" }]}> 
                    <ModelAutoComplete options={modelOptions} placeholder="可下拉选择，也可直接输入模型名" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name={["ai", "baseURL"]} label="Base URL" tooltip={aiHelp("baseURL")} rules={[{ required: true, message: "请输入 baseURL" }]}> 
                    <Input placeholder="https://aaii.xclaw.info/v1/" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="apiKeyAction" label="API Key 操作" tooltip={aiHelp("apiKey")}> 
                    <Select options={[{ value: "keep", label: "保持当前 Key" }, { value: "replace", label: "替换为新 Key" }, { value: "clear", label: "清空 Key（停用 AI）" }]} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name={["ai", "apiKey"]} label="新 API Key" tooltip={{ title: "保持当前 Key 时这里留空；选择替换时才会写入 Nacos。", icon: <InfoCircleOutlined /> }}>
                    <Input.Password disabled={watchedApiKeyAction !== "replace"} placeholder={watchedApiKeyAction === "replace" ? "粘贴新 API Key" : detail?.config.ai.apiKeyMasked || "未配置"} autoComplete="new-password" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "contentEnabled"]} label="内容分析总闸" valuePropName="checked" tooltip={aiHelp("contentEnabled")}> 
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "projectAttitudeEnabled"]} label="态度评价总闸" valuePropName="checked" tooltip={aiHelp("projectAttitudeEnabled")}> 
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "contentBatchSize"]} label="内容批大小" tooltip={aiHelp("contentBatchSize")}>
                    <InputNumber min={1} max={500} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "projectAttitudeBatchSize"]} label="态度批大小" tooltip={aiHelp("projectAttitudeBatchSize")}>
                    <InputNumber min={1} max={1000} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "contentConcurrency"]} label="内容并发" tooltip={aiHelp("contentConcurrency")}>
                    <InputNumber min={1} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "projectAttitudeConcurrency"]} label="态度并发" tooltip={aiHelp("projectAttitudeConcurrency")}>
                    <InputNumber min={1} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "maxTextLength"]} label="截断字符" tooltip={aiHelp("maxTextLength")}>
                    <InputNumber min={200} max={5000} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "negativeScoreThreshold"]} label="负面阈值" tooltip={aiHelp("negativeScoreThreshold")}>
                    <InputNumber min={0} max={10} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name={["ai", "positiveScoreThreshold"]} label="正面阈值" tooltip={aiHelp("positiveScoreThreshold")}>
                    <InputNumber min={0} max={10} step={0.1} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Collapse
              className="social-listening-ai-advanced-collapse"
              bordered={false}
              items={[
                {
                  key: "advanced",
                  label: "高级参数：专项模型 / 费用单价 / Prompt",
                  children: (
                    <Row gutter={[12, 4]}>
                      <Col xs={24} md={8}><Form.Item name={["ai", "tweetTagModel"]} label="标签模型" tooltip={aiHelp("tweetTagModel")}><ModelAutoComplete options={modelOptions} placeholder="为空用默认模型，也可直接输入" /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "tweetSummaryModel"]} label="摘要模型" tooltip={aiHelp("tweetSummaryModel")}><ModelAutoComplete options={modelOptions} placeholder="为空用默认模型，也可直接输入" /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "projectAttitudeModel"]} label="态度模型" tooltip={aiHelp("projectAttitudeModel")}><ModelAutoComplete options={modelOptions} placeholder="为空用默认模型，也可直接输入" /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "temperature"]} label="温度" tooltip={aiHelp("temperature")}><InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "maxTokens"]} label="默认输出上限" tooltip={aiHelp("maxTokens")}><InputNumber min={128} max={8000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "timeoutMs"]} label="超时时间 ms" tooltip={aiHelp("timeoutMs")}><InputNumber min={1000} max={300000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "maxRetries"]} label="重试次数" tooltip={aiHelp("maxRetries")}><InputNumber min={0} max={5} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "tweetTagMaxTokens"]} label="标签输出上限" tooltip={aiHelp("tweetTagMaxTokens")}><InputNumber min={128} max={8000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "tweetSummaryMaxTokens"]} label="摘要输出上限" tooltip={aiHelp("tweetSummaryMaxTokens")}><InputNumber min={64} max={4000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "projectAttitudeMaxTokens"]} label="态度输出上限" tooltip={aiHelp("projectAttitudeMaxTokens")}><InputNumber min={128} max={8000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "summaryWords"]} label="摘要词数" tooltip={aiHelp("summaryWords")}><InputNumber min={3} max={80} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "estimateInputPricePerMillion"]} label="输入单价 / 100万 token" tooltip={aiHelp("estimateInputPricePerMillion")}><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "estimateOutputPricePerMillion"]} label="输出单价 / 100万 token" tooltip={aiHelp("estimateOutputPricePerMillion")}><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "promptMaxLength"]} label="Prompt 最大长度" tooltip={aiHelp("promptMaxLength")}><InputNumber min={200} max={30000} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "estimateContentInputTokens"]} label="内容输入 token/次" tooltip={aiHelp("estimateContentInputTokens")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "estimateContentOutputTokens"]} label="内容输出 token/次" tooltip={aiHelp("estimateContentOutputTokens")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "estimateProjectAttitudeInputTokens"]} label="态度输入 token/次" tooltip={aiHelp("estimateProjectAttitudeInputTokens")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={24} md={6}><Form.Item name={["ai", "estimateProjectAttitudeOutputTokens"]} label="态度输出 token/次" tooltip={aiHelp("estimateProjectAttitudeOutputTokens")}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col span={24}><Form.Item name={["ai", "systemPrompt"]} label="系统 Prompt" tooltip={{ title: "全局 systemPrompt，会拼到结构化 JSON 输出要求前面。", icon: <InfoCircleOutlined /> }}><TextArea rows={2} /></Form.Item></Col>
                      <Col xs={24} lg={8}><Form.Item name={["ai", "prompts", "projectAttitude"]} label="项目态度 Prompt" tooltip={{ title: "覆盖代码默认 projectAttitude Prompt；看板级 Prompt 优先级更高。", icon: <InfoCircleOutlined /> }}><TextArea rows={3} /></Form.Item></Col>
                      <Col xs={24} lg={8}><Form.Item name={["ai", "prompts", "tweetTag"]} label="标签 Prompt" tooltip={{ title: "覆盖代码默认 tweetTag Prompt；用于主题、热词、词云。", icon: <InfoCircleOutlined /> }}><TextArea rows={3} /></Form.Item></Col>
                      <Col xs={24} lg={8}><Form.Item name={["ai", "prompts", "tweetSummary"]} label="摘要 Prompt" tooltip={{ title: "覆盖代码默认 tweetSummary Prompt；中英文摘要都会用。", icon: <InfoCircleOutlined /> }}><TextArea rows={3} /></Form.Item></Col>
                    </Row>
                  ),
                },
              ]}
            />
            <Space className="social-listening-ai-runtime-actions" wrap>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>保存全局 AI 配置到 Nacos</Button>
              <Text type="secondary">不会立即消耗 AI；账号级开关默认关闭，必须逐个确认预算后才会跑。</Text>
            </Space>
          </Form>
        </Col>
      </Row>
    </Space>
  );
}

function AiProgressLine({
  title,
  item,
  enabled,
}: {
  title: string;
  item?: { done: number; pending: number; total: number; percent: number; batchSize: number; batchesRemaining: number; estimatedMinutesRemaining: number };
  enabled?: boolean;
}) {
  if (!item) return null;
  const percent = Math.min(100, Math.max(0, Number(item.percent || 0)));
  const status = enabled && item.pending > 0 ? "active" : item.pending > 0 ? "normal" : "success";
  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <Space size={6}>
          <Text strong>{title}</Text>
          {enabled ? <Tag color="green">补跑中</Tag> : <Tag>未生效</Tag>}
        </Space>
        <Text type="secondary">已 {formatNumber(item.done)} / 总 {formatNumber(item.total)}</Text>
      </div>
      <Progress percent={percent} size="small" status={status} />
      <Text type="secondary">
        待处理 {formatNumber(item.pending)} 条；每轮最多 {item.batchSize} 条，剩余约 {item.batchesRemaining} 轮，ETA {enabled ? formatEtaMinutes(item.estimatedMinutesRemaining) : "开启后开始估算"}。
      </Text>
    </Space>
  );
}

function BoardAiConfigPanel({ boardId, open, onChanged }: { boardId: string; open: boolean; onChanged: () => void }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm();
  const configQuery = useQuery({
    queryKey: ["social-listening", "board-ai-config", boardId],
    queryFn: () => fetchSocialListeningBoardAiConfig(boardId),
    enabled: open && Boolean(boardId),
    refetchInterval: open ? 60_000 : false,
  });
  const llmModelsQuery = useQuery({
    queryKey: ["llm-models"],
    queryFn: fetchLlmModels,
    enabled: open && Boolean(boardId),
  });
  const modelOptions = useMemo(() => mergeModelOptions(llmModelsQuery.data?.data || []), [llmModelsQuery.data?.data]);
  const detail = configQuery.data?.data || null;
  const runtime = detail?.runtime;
  const stats = detail?.stats;
  const progress = detail?.progress;
  const watchedAi = Form.useWatch("ai", form) as Partial<SocialListeningBoardAiRuntimeConfig> | undefined;
  const watchedAcceptCost = Form.useWatch("acceptCost", form) as boolean | undefined;
  const estimatePosts = Number(watchedAi?.estimatePosts ?? detail?.config.estimatePosts ?? 10000);
  const liveEstimate = calculateAiCost({
    ...runtime,
    ...watchedAi,
    contentEnabled: Boolean(runtime?.contentEnabled && watchedAi?.contentEnabled),
    projectAttitudeEnabled: Boolean(runtime?.projectAttitudeEnabled && watchedAi?.projectAttitudeEnabled),
  }, estimatePosts);
  const wantsAi = Boolean(watchedAi?.contentEnabled || watchedAi?.projectAttitudeEnabled);
  const contentBlocked = Boolean(watchedAi?.contentEnabled && !runtime?.contentEnabled);
  const attitudeBlocked = Boolean(watchedAi?.projectAttitudeEnabled && !runtime?.projectAttitudeEnabled);

  useEffect(() => {
    if (!detail?.config) return;
    const nextEstimatePosts = Math.max(
      detail.config.estimatePosts || 0,
      detail.stats.contentPendingPosts || 0,
      detail.stats.projectAttitudePendingPosts || 0,
      10000
    );
    form.setFieldsValue({
      acceptCost: false,
      ai: {
        contentEnabled: Boolean(detail.config.contentEnabled),
        projectAttitudeEnabled: Boolean(detail.config.projectAttitudeEnabled),
        model: detail.config.model || "",
        tweetTagModel: detail.config.tweetTagModel || "",
        tweetSummaryModel: detail.config.tweetSummaryModel || "",
        projectAttitudeModel: detail.config.projectAttitudeModel || "",
        estimatePosts: nextEstimatePosts,
      },
    });
  }, [detail, form]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue(true) as { acceptCost?: boolean; ai?: Partial<SocialListeningBoardAiRuntimeConfig> };
      const ai = values.ai || {};
      const enabling = Boolean(ai.contentEnabled || ai.projectAttitudeEnabled);
      if (enabling && !values.acceptCost) throw new Error("开启该账号 AI 前，请先勾选确认预估成本。关闭 AI 不需要确认成本。");
      return updateSocialListeningBoardAiConfig(boardId, {
        acceptCost: Boolean(values.acceptCost),
        ai: { ...ai, acceptCost: Boolean(values.acceptCost) },
      });
    },
    onSuccess: () => {
      messageApi.success("该被监控账号的 AI 开关已保存");
      void configQuery.refetch();
      onChanged();
    },
    onError: (error: Error) => messageApi.error(error.message || "保存账号 AI 配置失败"),
  });

  return (
    <Space direction="vertical" size={12} className="social-listening-full">
      {contextHolder}
      <Alert
        type="warning"
        showIcon
        message="按被监控账号单独控制 AI，默认关闭"
        description="全局页只配置模型服务商、价格估算和总开关；这里才决定当前账号是否跑 AI。关闭后，后续采集任务到 AI 阶段会直接跳过该账号，已入库历史 AI 字段不会自动删除。"
      />
      <AiPostProcessingGuide compact defaultCollapsed />
      {detail?.blockingReasons?.length ? (
        <Alert type="info" showIcon message="开启前需要补齐" description={<Space size={4} wrap>{detail.blockingReasons.map((item) => <Tag key={item}>{item}</Tag>)}</Space>} />
      ) : null}
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={7}>
          <Card size="small" title="当前账号预算">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Row gutter={[8, 8]}>
                <Col span={12}><Statistic title="帖子总数" value={stats?.totalPosts || 0} /></Col>
                <Col span={12}><Statistic title="估算帖子" value={liveEstimate.posts} /></Col>
                <Col span={12}><Statistic title="内容待分析" value={stats?.contentPendingPosts || 0} /></Col>
                <Col span={12}><Statistic title="态度待评价" value={stats?.projectAttitudePendingPosts || 0} /></Col>
              </Row>
              <Divider style={{ margin: "2px 0" }} />
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <AiProgressLine title="内容分析进度" item={progress?.content} enabled={detail?.config.effective.contentEnabled} />
                <AiProgressLine title="态度评价进度" item={progress?.projectAttitude} enabled={detail?.config.effective.projectAttitudeEnabled} />
                {progress ? (
                  <Text type="secondary">
                    整体 ETA {formatEtaMinutes(progress.estimatedMinutesRemaining)}；按独立 AI Worker 每约 {progress.intervalMinutes} 分钟一轮估算。
                  </Text>
                ) : null}
              </Space>
              <Divider style={{ margin: "2px 0" }} />
              <Statistic title="预计 AI 调用" value={liveEstimate.calls} suffix="次" />
              <Statistic title="预计费用" value={formatUsd(liveEstimate.estimatedUsd)} valueStyle={{ color: wantsAi ? "#d46b08" : undefined }} />
              <Text type="secondary">保存开启时会把这次预估费用和调用次数写入 metadata.aiRuntime，方便后续审计。</Text>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="上次确认">{formatDate(detail?.config.costAcceptedAt)}</Descriptions.Item>
                <Descriptions.Item label="确认费用">{formatUsd(detail?.config.acceptedEstimatedUsd)}</Descriptions.Item>
                <Descriptions.Item label="确认调用">{detail?.config.acceptedCalls || 0} 次</Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card size="small" title="账号 AI 开关">
            <Form form={form} layout="vertical" onFinish={() => updateMutation.mutate()}>
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name={["ai", "model"]} label="该账号模型" extra="必填。管理员必须为这个被监控账号明确选择模型，不能只靠全局默认值。" rules={[{ required: wantsAi, message: "开启账号 AI 前必须填写模型" }]}> 
                    <ModelAutoComplete options={modelOptions} placeholder={runtime?.model ? `默认：${runtime.model}` : "可下拉选择，也可直接输入模型名"} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name={["ai", "contentEnabled"]} label="该账号内容分析" valuePropName="checked" extra={contentBlocked ? "全局内容分析总开关未开启，当前账号不能生效。" : "开启后：标签 + 中文摘要 + 英文摘要，约每条 3 次调用。"}>
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name={["ai", "projectAttitudeEnabled"]} label="该账号态度评价" valuePropName="checked" extra={attitudeBlocked ? "全局项目态度总开关未开启，当前账号不能生效。" : "开启后：评价对项目态度，约每条 1 次调用。"}>
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name={["ai", "estimatePosts"]} label="本次预估帖子数" extra="建议不低于当前待 AI 分析帖子数；只用于成本确认，不影响任务扫描范围。">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name="acceptCost" valuePropName="checked" extra={wantsAi ? `我已确认当前账号使用 ${watchedAi?.model || "未选模型"}，预计 ${liveEstimate.calls} 次调用，约 ${formatUsd(liveEstimate.estimatedUsd)}。` : "关闭该账号 AI 时不需要确认成本。"}>
                    <Checkbox disabled={!wantsAi}>确认该账号模型和预估成本，允许开启 AI 分析</Checkbox>
                  </Form.Item>
                </Col>
              </Row>
              <Collapse
                bordered={false}
                items={[{
                  key: "advanced-board-ai",
                  label: "专项模型覆盖（可选）",
                  children: (
                    <Row gutter={12}>
                      <Col xs={24} md={8}><Form.Item name={["ai", "tweetTagModel"]} label="标签模型" extra="为空使用该账号模型。"><ModelAutoComplete options={modelOptions} placeholder="为空使用该账号模型，也可直接输入" /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "tweetSummaryModel"]} label="摘要模型" extra="为空使用该账号模型。"><ModelAutoComplete options={modelOptions} placeholder="为空使用该账号模型，也可直接输入" /></Form.Item></Col>
                      <Col xs={24} md={8}><Form.Item name={["ai", "projectAttitudeModel"]} label="态度模型" extra="为空使用该账号模型。"><ModelAutoComplete options={modelOptions} placeholder="为空使用该账号模型，也可直接输入" /></Form.Item></Col>
                      <Col span={24}>
                        <Descriptions size="small" bordered column={2}>
                          <Descriptions.Item label="Base URL">{runtime?.baseURL || "未配置"}</Descriptions.Item>
                          <Descriptions.Item label="API Key">{runtime?.apiKeyConfigured ? runtime.apiKeyMasked || "已配置" : "未配置"}</Descriptions.Item>
                          <Descriptions.Item label="全局内容总开关">{runtime?.contentEnabled ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag>}</Descriptions.Item>
                          <Descriptions.Item label="全局态度总开关">{runtime?.projectAttitudeEnabled ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag>}</Descriptions.Item>
                          <Descriptions.Item label="实际内容生效">{detail?.config.effective.contentEnabled ? <Tag color="green">生效</Tag> : <Tag>未生效</Tag>}</Descriptions.Item>
                          <Descriptions.Item label="实际态度生效">{detail?.config.effective.projectAttitudeEnabled ? <Tag color="green">生效</Tag> : <Tag>未生效</Tag>}</Descriptions.Item>
                        </Descriptions>
                      </Col>
                    </Row>
                  ),
                }]}
              />
              <Space style={{ marginTop: 14 }} wrap>
                <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>保存该账号 AI 开关</Button>
                <Button onClick={() => configQuery.refetch()} loading={configQuery.isFetching}>重新读取</Button>
                {wantsAi && !watchedAcceptCost ? <Text type="warning">开启前必须勾选成本确认。</Text> : <Text type="secondary">随时可关闭；关闭立即让后续任务跳过该账号 AI 阶段。</Text>}
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

interface BoardDrawerProps {
  board: SocialListeningBoard | null;
  open: boolean;
  initialTab?: string;
  onClose: () => void;
  onChanged: () => void;
}

function BoardDrawer({ board, open, initialTab = "workflow", onClose, onChanged }: BoardDrawerProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [range, setRange] = useState("7D");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [accessForm] = Form.useForm();
  const [postQuery, setPostQuery] = useState({ q: "", sentiment: "", source: "", sort: "time_desc" });
  const boardId = board?.id || "";

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab, boardId]);

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
  const vipListsQuery = useQuery({
    queryKey: ["social-listening", "vip-lists"],
    queryFn: fetchVipLists,
    enabled: open,
  });

  const vipUsers = vipListsQuery.data?.data.vip || [];
  const internalTestUsers = vipListsQuery.data?.data.internalTest || [];
  const accessUserOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...internalTestUsers, ...vipUsers].reduce<Array<{ value: string; label: string }>>((options, item) => {
      const handle = normalizeHandle(item.username);
      if (!handle || seen.has(handle)) return options;
      seen.add(handle);
      const source = internalTestUsers.some((candidate) => normalizeHandle(candidate.username) === handle) ? "内测" : "VIP";
      options.push({
        value: handle,
        label: item.twitterId ? `${item.username} · ${source} · ${item.twitterId}` : `${item.username} · ${source}`,
      });
      return options;
    }, []);
  }, [internalTestUsers, vipUsers]);

  function addAccessUsersToForm(items: VipListItem[]) {
    const current = normalizeHandleList(accessForm.getFieldValue("twitterHandles"));
    accessForm.setFieldsValue({
      twitterHandles: normalizeHandleList([...current, ...items.map((item) => item.username)]),
    });
  }

  const grantMutation = useMutation({
    mutationFn: async (values: { twitterHandles?: string[] }) => {
      const handles = normalizeHandleList(values.twitterHandles);
      if (!handles.length) throw new Error("请选择或输入至少一个 EchoHunt 账号 X Handle");
      const userByHandle = [...internalTestUsers, ...vipUsers].reduce<Record<string, VipListItem>>((map, item) => {
        const handle = normalizeHandle(item.username);
        if (handle) map[handle] = item;
        return map;
      }, {});
      return Promise.all(handles.map((handle) => grantSocialListeningAccess(boardId, {
        twitterHandle: handle,
        twitterId: userByHandle[handle]?.twitterId || undefined,
      })));
    },
    onSuccess: (results) => { messageApi.success(`已分配 ${results.length} 个可见账号`); accessForm.resetFields(); void accessesQuery.refetch(); onChanged(); },
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
    { title: "被分配 EchoHunt 账号", dataIndex: "twitterHandle", width: 220, render: (value: string) => <Text strong>@{value}</Text> },
    { title: "Twitter ID", dataIndex: "twitterId", width: 170, render: (value?: string | null) => value || "-" },
    { title: "AuthCenter User ID", dataIndex: "authCenterUserId", width: 240, ellipsis: true, render: (value?: string | null) => value || "未绑定" },
    { title: "XHunt User ID", dataIndex: "xhuntUserId", width: 150, render: (value?: string | null) => value || "-" },
    { title: "状态", dataIndex: "status", width: 90, render: statusTag },
    { title: "授权时间", dataIndex: "grantedAt", width: 170, render: formatDate },
    { title: "操作", width: 90, render: (_, row) => row.status === "active" ? <Tooltip title="撤销后，该 EchoHunt 账号将不能再看到这个被监控账户的 Social Listening 看板。"><span><Popconfirm title="撤销该账号访问权限？" okText="撤销" cancelText="取消" onConfirm={() => revokeMutation.mutate(row.id)}><Button size="small" danger>撤销</Button></Popconfirm></span></Tooltip> : null },
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
    { title: "账号", width: 260, render: (_, row) => <Space><Avatar src={row.avatar || undefined}>{(row.handle || row.name || "?").slice(0, 1).toUpperCase()}</Avatar><Space direction="vertical" size={0}><Text strong>{row.name || row.handle || row.twitterId}</Text><Text type="secondary">@{row.handle || "-"} · <Text code>{row.twitterId}</Text></Text></Space></Space> },
    { title: "类型", dataIndex: "signalType", width: 190, render: (value: string) => <Tag color="geekblue">{value}</Tag> },
    { title: "影响力", width: 210, render: (_, row) => <Space direction="vertical" size={0}><Text>粉丝 {formatNumber(row.followersCount)}</Text><Space size={4} wrap><Tag>G {formatRank(row.globalRank)}</Tag><Tag color="blue">CN {formatRank(row.cnRank)}</Tag></Space></Space> },
    { title: "窗口数据", width: 220, render: (_, row) => <Space size={4} wrap><Tag>提及 {getOptionalNumber(row.mentionCount) ?? 0}</Tag><Tag color="purple">曝光 {formatNumber(row.viewsCount)}</Tag><Tag color="green">互动 {formatNumber(row.engagementCount)}</Tag>{row.sentiment ? statusTag(row.sentiment) : null}</Space> },
    { title: "关系来源", width: 230, render: (_, row) => {
      const snapshot = asRecord(row.rankSnapshot);
      return <Space direction="vertical" size={0}><Text code>{getString(snapshot.sourceTable) || "-"}</Text><Text type="secondary">{getString(snapshot.direction) || "-"}</Text></Space>;
    } },
    { title: "摘要/主题", ellipsis: true, render: (_, row) => <Space direction="vertical" size={0}><Text ellipsis>{row.summaryZh || "-"}</Text>{Array.isArray(row.topics) && row.topics.length ? <Space size={4} wrap>{row.topics.slice(0, 4).map((topic) => <Tag key={topic}>{topic}</Tag>)}</Space> : null}</Space> },
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
          <BoardOverview board={board} />
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "workflow",
                label: "执行过程",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Alert type="info" showIcon message="这里仅展示当前账号的实际任务记录；完整流程说明已放在页面底部「流程总览」。" /><Table rowKey="id" size="small" columns={jobColumns} dataSource={jobsQuery.data?.data.items || []} loading={jobsQuery.isFetching} pagination={false} scroll={{ x: 1280 }} expandable={{ expandedRowRender: (row) => <JobProgressView job={row} /> }} /></Space>,
              },
              {
                key: "posts",
                label: "推文字段追踪",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Alert type="info" showIcon message="展开每条推文，可以看到 AI 生成了哪些字段，以及这些字段保存在哪个表。" /><Space wrap><Select value={range} onChange={setRange} options={RANGE_OPTIONS} style={{ width: 100 }} /><Input.Search placeholder="搜索内容/作者" allowClear onSearch={(q) => setPostQuery((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={postQuery.sentiment} onChange={(sentiment) => setPostQuery((prev) => ({ ...prev, sentiment }))} style={{ width: 130 }} options={[{ value: "", label: "全部情绪" }, { value: "negative", label: "负面" }, { value: "neutral", label: "中性" }, { value: "positive", label: "正面" }, { value: "unknown", label: "未知" }]} /><Button icon={<DownloadOutlined />} onClick={() => window.open(buildSocialListeningExportUrl(board.id, { range, ...postQuery }), "_blank")}>导出</Button></Space><Table rowKey="id" size="small" columns={postColumns} dataSource={postsQuery.data?.data.items || []} loading={postsQuery.isFetching} pagination={false} scroll={{ x: 1180 }} expandable={{ expandedRowRender: (row) => <PostAiInspector post={row} /> }} /></Space>,
              },
              {
                key: "ai",
                label: "AI 开关",
                children: <BoardAiConfigPanel boardId={board.id} open={open} onChanged={onChanged} />,
              },
              {
                key: "signals",
                label: "关键账号动态",
                children: <Space direction="vertical" size={12} className="social-listening-full"><Alert type="info" showIcon message="这里展示被关注/互动的关键账号画像，不只看华语排名；展开行可查看来源表、关系方向和 rankSnapshot 原始字段。" /><Select value={range} onChange={setRange} options={RANGE_OPTIONS} /><Table rowKey="id" size="small" columns={signalColumns} dataSource={signalsQuery.data?.data.items || []} loading={signalsQuery.isFetching} pagination={false} scroll={{ x: 1500 }} expandable={{ expandedRowRender: (row) => <SignalInspector signal={row} /> }} /></Space>,
              },
              {
                key: "alerts",
                label: "异常/预警",
                children: <Table rowKey="id" size="small" columns={alertColumns} dataSource={alertsQuery.data?.data.items || []} loading={alertsQuery.isFetching} pagination={false} scroll={{ x: 980 }} />,
              },
              {
                key: "access",
                label: "分配可见账号",
                children: (
                  <Space direction="vertical" size={12} className="social-listening-full">
                    <Alert
                      type="info"
                      showIcon
                      message="这里就是把当前被监控账户分配给 EchoHunt 账号看的地方"
                      description="选择内测/VIP 用户，或输入 EchoHunt 用户绑定的 X Handle 后保存授权。系统会尝试从 AuthCenter 绑定关系补齐 AuthCenter User ID / XHunt User ID；保存后这些用户即可在前台访问这个 Social Listening 看板。"
                    />
                    <Card size="small" title="新增可见账号" className="social-listening-access-card">
                      <Form form={accessForm} layout="vertical" onFinish={(values) => grantMutation.mutate(values)}>
                        <Form.Item
                          name="twitterHandles"
                          label="EchoHunt 可见账号"
                          rules={[{ required: true, message: "请选择或输入至少一个 EchoHunt 用户绑定的 X handle" }]}
                          extra="可从内测/VIP 名单下拉选择；也可以直接输入 X 用户名、@handle 或 x.com 链接，回车添加。"
                        >
                          <Select
                            mode="tags"
                            allowClear
                            showSearch
                            maxTagCount="responsive"
                            loading={vipListsQuery.isFetching}
                            placeholder="选择内测用户，或输入 handle 后回车"
                            options={accessUserOptions}
                            tokenSeparators={[",", "\n", " "]}
                            onChange={(values) => accessForm.setFieldsValue({ twitterHandles: normalizeHandleList(values) })}
                            popupRender={(menu) => (
                              <>
                                {menu}
                                <div
                                  className="social-listening-access-dropdown-actions"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  <Space size={8} wrap>
                                    <Button size="small" disabled={!internalTestUsers.length} onClick={() => addAccessUsersToForm(internalTestUsers)}>
                                      一键添加内测用户
                                    </Button>
                                    <Button size="small" disabled={!vipUsers.length} onClick={() => addAccessUsersToForm(vipUsers)}>
                                      一键添加 VIP
                                    </Button>
                                  </Space>
                                </div>
                              </>
                            )}
                          />
                        </Form.Item>
                        <Tooltip title="把这个被监控账户分配给上面选择/输入的 EchoHunt 账号，让这些账号可以在前台看到此看板。">
                          <Button type="primary" htmlType="submit" loading={grantMutation.isPending}>分配给选中账号</Button>
                        </Tooltip>
                      </Form>
                    </Card>
                    <Table rowKey="id" size="small" columns={accessColumns} dataSource={accessesQuery.data?.data.items || []} loading={accessesQuery.isFetching} pagination={false} scroll={{ x: 1120 }} />
                  </Space>
                ),
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
  const [drawerInitialTab, setDrawerInitialTab] = useState("workflow");
  const [formOpen, setFormOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedTwitterAccount | null>(null);
  const [form] = Form.useForm();

  const boardsQuery = useQuery({
    queryKey: ["social-listening", "boards", filters],
    queryFn: () => fetchSocialListeningBoards({ pageSize: 50, ...filters }),
    refetchInterval: 15_000,
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
  const aiWorkerQuery = useQuery({
    queryKey: ["social-listening", "ai-worker-status"],
    queryFn: fetchSocialListeningAiWorkerStatus,
    refetchInterval: 15_000,
  });

  const boards = boardsQuery.data?.data.items || [];
  const activeCount = boards.filter((item) => item.status === "monitoring").length;
  const failedCount = boards.filter((item) => item.status === "failed").length;
  const runningJobs = (jobsQuery.data?.data.items || []).filter((item) => ["pending", "running"].includes(item.status)).length;
  const aiWorkerStatus = aiWorkerQuery.data?.data || null;
  const aiWorkerLastRun = asRecord(aiWorkerStatus?.lastRun);

  useEffect(() => {
    if (!drawerBoard?.id) return;
    const latest = boards.find((item) => item.id === drawerBoard.id);
    if (latest) setDrawerBoard(latest);
  }, [boards, drawerBoard?.id]);

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
  const pauseAiWorkerMutation = useMutation({
    mutationFn: pauseSocialListeningAiWorker,
    onSuccess: () => { messageApi.success("AI Worker 已暂停"); void aiWorkerQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "暂停 AI Worker 失败"),
  });
  const resumeAiWorkerMutation = useMutation({
    mutationFn: resumeSocialListeningAiWorker,
    onSuccess: () => { messageApi.success("AI Worker 已恢复"); void aiWorkerQuery.refetch(); },
    onError: (error: Error) => messageApi.error(error.message || "恢复 AI Worker 失败"),
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

  function openDrawer(board: SocialListeningBoard, tab = "workflow") {
    setDrawerInitialTab(tab);
    setDrawerBoard(board);
  }

  const columns = useMemo<TableProps<SocialListeningBoard>["columns"]>(() => [
    { title: "被监控账号", width: 260, render: (_, row) => <Space><Avatar src={row.projectAvatar || undefined} style={{ backgroundColor: row.brandColor || undefined }}>{row.projectName.slice(0, 1)}</Avatar><Space direction="vertical" size={0}><Text strong>{row.projectName}</Text><Text type="secondary">@{row.officialHandle}{row.verified ? <Tag color="blue" style={{ marginLeft: 6 }}>verified</Tag> : null}</Text></Space></Space> },
    { title: "状态", dataIndex: "status", width: 105, render: statusTag },
    { title: "粉丝/排名", width: 160, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatNumber(row.followersCount)}</Text><Text type="secondary">G {row.globalRank || "-"} · CN {row.cnRank || "-"}</Text></Space> },
    { title: "数据", width: 150, render: (_, row) => <Space direction="vertical" size={0}><Text>{row.postCount || 0} posts</Text><Text type="secondary">已分配 {row.accessCount || 0} 个账号</Text></Space> },
    { title: "AI", width: 170, render: (_, row) => renderBoardAiStatus(row) },
    { title: "处理进度", width: 250, render: (_, row) => <Space direction="vertical" size={0}><Text>{formatDate(row.processedThrough)}</Text><Text type={row.lastFailureReason ? "danger" : "secondary"}>{row.lastFailureReason || `最近成功 ${formatDate(row.lastSuccessAt)}`}</Text></Space> },
    { title: "最新任务", width: 190, render: (_, row) => row.latestJob ? <Space direction="vertical" size={0}>{statusTag(row.latestJob.status)}<Text type="secondary">{row.latestJob.jobType}</Text></Space> : "-" },
    {
      title: "操作",
      fixed: "right",
      width: 250,
      render: (_, row) => {
        const moreItems: MenuProps["items"] = [
          { key: "refresh", icon: <ThunderboltOutlined />, label: "刷新数据" },
          { key: "delete", icon: <DeleteOutlined />, label: <Text type="danger">删除看板</Text>, danger: true },
        ];
        const handleMoreClick: MenuProps["onClick"] = ({ key }) => {
          if (key === "refresh") {
            refreshMutation.mutate(row.id);
            return;
          }
          if (key === "delete") {
            Modal.confirm({
              title: "软删除该看板？",
              content: "会从正常列表隐藏，不做物理删库；已入库历史数据不会在这里直接清空。",
              okText: "删除",
              okButtonProps: { danger: true },
              cancelText: "取消",
              onOk: () => deleteMutation.mutate(row.id),
            });
          }
        };
        return (
          <Space size={6} wrap>
            <Tooltip title="打开详情抽屉，查看定时任务执行过程、推文字段追踪、AI 开关、关键账号动态和异常预警。">
              <Button size="small" onClick={() => openDrawer(row)}>管理</Button>
            </Tooltip>
            <Tooltip title="为这个被监控账户单独开启/关闭 AI；默认关闭，开启前必须确认模型和预估成本。">
              <Button size="small" onClick={() => openDrawer(row, "ai")}>AI</Button>
            </Tooltip>
            <Tooltip title="修改该监控账号的项目资料、召回关键词、关注关系源和 AI 提示语；保存配置不会立即跑任务。">
              <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
            </Tooltip>
            {row.status === "paused" ? (
              <Tooltip title="恢复自动监控；首次恢复会先补最近 7 天，再低优先级补齐 30 天，之后交给定时任务增量处理。">
                <Button size="small" icon={<PlayCircleOutlined />} onClick={() => resumeMutation.mutate(row.id)}>恢复</Button>
              </Tooltip>
            ) : (
              <Tooltip title="暂停该账号的自动定时处理；配置和已入库数据保留，后续可点击恢复继续。">
                <Button size="small" icon={<PauseCircleOutlined />} onClick={() => pauseMutation.mutate(row.id)}>暂停</Button>
              </Tooltip>
            )}
            <Dropdown menu={{ items: moreItems, onClick: handleMoreClick }} trigger={["click"]}>
              <Button size="small" icon={<MoreOutlined />}>更多</Button>
            </Dropdown>
          </Space>
        );
      },
    },
  ], [deleteMutation, pauseMutation, refreshMutation, resumeMutation]);

  return (
    <PermissionGuard permission="social-listening">
      {contextHolder}
      <Space direction="vertical" size={16} className="social-listening-admin-page">
        <div className="social-listening-hero">
          <div>
            <Text className="social-listening-kicker">EchoHunt Ops</Text>
            <Typography.Title level={2}>舆论监控管理台</Typography.Title>
            <Paragraph type="secondary">维护被监控账号、配置 AI 提示语，并追踪后台采集任务、入库字段与预警异常。</Paragraph>
          </div>
          <Space wrap size={8} className="social-listening-hero-metrics">
            <Card size="small" className="social-listening-hero-metric"><Statistic title="看板数" value={boards.length} /></Card>
            <Card size="small" className="social-listening-hero-metric"><Statistic title="监控中" value={activeCount} /></Card>
            <Card size="small" className="social-listening-hero-metric"><Statistic title="运行中任务" value={runningJobs} /></Card>
            <Card size="small" className="social-listening-hero-metric"><Statistic title="失败" value={failedCount} valueStyle={{ color: failedCount ? "#cf1322" : undefined }} /></Card>
          </Space>
        </div>


        <Card
          size="small"
          title="AI Worker 独立回填"
          extra={<Space wrap>
            {aiWorkerStatus?.enabled ? <Tag color="green">运行中</Tag> : <Tag color="orange">已暂停</Tag>}
            <Button size="small" icon={<ReloadOutlined />} loading={aiWorkerQuery.isFetching} onClick={() => aiWorkerQuery.refetch()}>刷新状态</Button>
            {aiWorkerStatus?.enabled ? (
              <Button size="small" icon={<PauseCircleOutlined />} loading={pauseAiWorkerMutation.isPending} onClick={() => pauseAiWorkerMutation.mutate()}>暂停 AI</Button>
            ) : (
              <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={resumeAiWorkerMutation.isPending} onClick={() => resumeAiWorkerMutation.mutate()}>恢复 AI</Button>
            )}
          </Space>}
        >
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={8} xl={6}>
              <Text type="secondary">采集任务仍按 15 分钟跑；AI 由这个 Worker 单独回填，可独立暂停。</Text>
            </Col>
            <Col xs={12} md={4}><Statistic title="内容成功/轮" value={getNumberFromRecord(aiWorkerLastRun, "contentAnalyzed")} /></Col>
            <Col xs={12} md={4}><Statistic title="态度成功/轮" value={getNumberFromRecord(aiWorkerLastRun, "attitudeAnalyzed")} /></Col>
            <Col xs={12} md={4}><Statistic title="耗时" value={Math.round(getNumberFromRecord(aiWorkerLastRun, "durationMs") / 1000)} suffix="秒" /></Col>
            <Col xs={12} md={4}><Statistic title="上次运行" value={formatDate(getString(aiWorkerLastRun.finishedAt))} /></Col>
          </Row>
        </Card>

        <PageSection
          title="被监控账号"
          description="新增账号默认暂停，不会自动跑任务；管理员点击恢复后先补最近 7 天数据，再低优先级补齐 30 天，后续增量任务每 15 分钟由 jobs 进程推进。"
          extra={<Space wrap><Input.Search placeholder="搜索项目 / handle" allowClear onSearch={(q) => setFilters((prev) => ({ ...prev, q }))} style={{ width: 220 }} /><Select value={filters.status} onChange={(status) => setFilters((prev) => ({ ...prev, status }))} options={STATUS_OPTIONS} style={{ width: 130 }} /><Tooltip title="重新加载被监控账号列表，只刷新管理台页面数据，不会触发采集或 AI 分析任务。"><Button icon={<ReloadOutlined />} loading={boardsQuery.isFetching} onClick={() => boardsQuery.refetch()}>刷新</Button></Tooltip><Tooltip title="新增一个被监控官方 X 账号；保存后默认暂停，需要点击恢复才会启动补数和定时监控。"><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增监控</Button></Tooltip></Space>}
        >
          <Table rowKey="id" size="small" columns={columns} dataSource={boards} loading={boardsQuery.isFetching} pagination={false} scroll={{ x: 1470 }} />
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

        <PageSection
          title="AI 总配置"
          description="全局模型服务商、总开关和费用估算放在这里；默认折叠，避免占用日常监控页面空间。"
        >
          <Collapse
            className="social-listening-ai-runtime-collapse"
            bordered={false}
            items={[
              {
                key: "ai-runtime",
                label: "展开配置全局 AI 供应商 / 总闸 / 费用估算",
                children: <AiRuntimeConfigPanel />,
              },
            ]}
          />
        </PageSection>
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

      <BoardDrawer board={drawerBoard} open={Boolean(drawerBoard)} initialTab={drawerInitialTab} onClose={() => setDrawerBoard(null)} onChanged={() => { void boardsQuery.refetch(); void jobsQuery.refetch(); void alertsQuery.refetch(); }} />
    </PermissionGuard>
  );
}
