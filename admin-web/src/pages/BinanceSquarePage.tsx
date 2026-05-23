import { useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Select,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Spin,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyActionButton, LegacyMetricCard } from "@/components/ui/LegacyAdmin";
import {
  addBinanceSquareSeed,
  calculateBinanceSquareTargets,
  crawlBinanceSquarePosts,
  fetchBinanceSquareConfig,
  fetchBinanceSquareFollowingList,
  fetchBinanceSquareLogs,
  fetchBinanceSquarePosts,
  fetchBinanceSquareProgress,
  fetchBinanceSquareSeeds,
  fetchBinanceSquareStats,
  fetchBinanceSquareStatus,
  fetchBinanceSquareTargetProgress,
  fetchBinanceSquareTargets,
  fetchBinanceSquareUserIntroProgress,
  forceStopBinanceSquareCrawl,
  generateBinanceSquareUserIntros,
  pauseBinanceSquareScheduler,
  purgeBinanceSquareSnapshots,
  recalculateBinanceSquarePostScores,
  resetBinanceSquareRunningTasks,
  removeBinanceSquareSeed,
  startBinanceSquareScheduler,
  syncBinanceSquareSeedFollowing,
  updateBinanceSquareConfig,
} from "@/services/binance-square";
import type { BinanceSquareRankSet } from "@/services/binance-square";
import type {
  BinanceSquareActionResult,
  BinanceSquareConfigItem,
  BinanceSquareCrawlLogItem,
  BinanceSquareFollowingUser,
  BinanceSquarePostItem,
  BinanceSquareSeedItem,
  BinanceSquareTargetRankItem,
} from "@/types/binance-square";

const TABLE_MAX_HEIGHT = 480;
const RANK_STAGES: Array<{ key: BinanceSquareRankSet; label: string; source: string; desc: string }> = [
  { key: "top50", label: "Top50", source: "Seed", desc: "同步 Seed 关注列表后计算" },
  { key: "top100", label: "Top100", source: "Top50", desc: "同步 Top50 关注列表后计算" },
  { key: "top300", label: "Top300", source: "Top100", desc: "同步 Top100 关注列表后计算" },
  { key: "top1000", label: "Top1000", source: "Top300", desc: "同步 Top300 并合并中间层" },
];

const CONFIG_HELP: Record<string, { label: string; desc: string; tip?: string }> = {
  post_crawl_days_back: {
    label: "帖子回溯天数",
    desc: "每次抓取目标用户最近多少天的帖子，并在这个时间窗口内重算热度分。",
    tip: "当前推荐窗口为 7 天。",
  },
  post_crawl_filter_types: {
    label: "抓取内容类型",
    desc: "调用币安广场接口时抓哪些内容类型。ALL 是主页内容，REPLY 是回复内容。",
    tip: "当前配置会同时抓取主页内容和回复内容。",
  },
  post_crawl_interval_hours: {
    label: "定时抓取间隔",
    desc: "调度器每隔多少小时尝试抓取一次 Top1000 近 7 天帖子。",
    tip: "这是尝试触发的间隔；如果上一轮还在运行或处于冷却期，系统会自动跳过。",
  },
  post_crawl_min_cooldown_minutes: {
    label: "完成后冷却时间",
    desc: "上一轮抓取完成后，至少等待多少分钟才允许下一轮开始。",
    tip: "用于降低访问频率和封控风险，当前建议 30 分钟。",
  },
  post_score_version: {
    label: "评分公式版本",
    desc: "帖子热度分的算法版本。当前 bs_post_v1 使用浏览、分享、评论、点赞和新鲜度加权。",
    tip: "后续调整公式时可升级版本，方便区分历史分数。",
  },
  snapshot_retention_days: {
    label: "旧镜像保留天数",
    desc: "历史镜像表的清理周期。新版本不再写完整帖子镜像，但旧数据仍按该配置清理。",
    tip: "当前只用于回收旧 snapshot 数据。",
  },
};
const HIDDEN_CONFIG_KEYS = new Set(["post_crawl_concurrency"]);

function getConfigHelp(configKey: string) {
  return CONFIG_HELP[configKey] || {
    label: configKey,
    desc: "自定义配置项，请结合后端说明使用。",
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : value;
}

function formatCompactNumber(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const abs = Math.abs(num);
  const format = (divisor: number, suffix: string) => {
    const compact = num / divisor;
    const digits = Math.abs(compact) >= 10 ? 0 : 1;
    return `${compact.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
  };
  if (abs >= 1_000_000) return format(1_000_000, "M");
  if (abs >= 1_000) return format(1_000, "k");
  return String(num);
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

function extractIntroDisplayText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (depth > 4) return safeJsonStringify(value);

  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractIntroDisplayText(item, depth + 1))
      .filter(Boolean)
      .join(" ")
      .trim();
    return text || safeJsonStringify(value);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const pickText = (keys: string[]) => {
      for (const key of keys) {
        if (record[key] !== null && record[key] !== undefined) {
          const text = extractIntroDisplayText(record[key], depth + 1).trim();
          if (text) return text;
        }
      }
      return "";
    };
    const zhText = pickText(["zh", "cn", "chinese", "chineseIntro", "zhIntro", "cnIntro", "中文", "中文介绍"]);
    const enText = pickText(["en", "english", "englishIntro", "enIntro", "英文", "英文介绍"]);
    if (zhText || enText) {
      return [zhText ? `中文：${zhText}` : "", enText ? `English: ${enText}` : ""].filter(Boolean).join("\n");
    }

    const preferredKeys = [
      "intro",
      "oneLineIntro",
      "one_line_intro",
      "aiOneLineIntro",
      "summary",
      "description",
      "text",
      "output_text",
      "content",
      "message",
    ];

    for (const key of preferredKeys) {
      if (record[key] !== null && record[key] !== undefined) {
        const text = extractIntroDisplayText(record[key], depth + 1);
        if (text) return text;
      }
    }

    const parsedValueText = Object.values(record)
      .map((item) => extractIntroDisplayText(item, depth + 1))
      .find((text) => text && text.trim().length >= 8);

    return parsedValueText || safeJsonStringify(value);
  }

  return String(value || "");
}

function parseBilingualIntro(value: unknown) {
  const raw = extractIntroDisplayText(value).replace(/\r\n?/g, "\n").trim();
  if (!raw) return { raw: "", zh: "", en: "" };

  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let zh = "";
  let en = "";

  for (const line of lines) {
    const zhMatch = line.match(/^(?:中文|Chinese|ZH|CN)[:：]\s*(.+)$/i);
    const enMatch = line.match(/^(?:英文|English|EN)[:：]\s*(.+)$/i);
    if (zhMatch) zh = zhMatch[1].trim();
    else if (enMatch) en = enMatch[1].trim();
  }

  if (!en) {
    const inlineEnglish = raw.match(/(?:^|\s)(?:English|英文|EN)[:：]\s*(.+)$/i);
    if (inlineEnglish) {
      en = inlineEnglish[1].trim();
      zh = (zh || raw.slice(0, inlineEnglish.index).replace(/^(?:中文|Chinese|ZH|CN)[:：]\s*/i, "")).trim();
    }
  }
  return { raw, zh, en, isValid: Boolean(zh && en) };
}

function hasChineseText(value?: string | null) {
  return /[\u3400-\u9fff]/.test(value || "");
}

function getChinesePostTitle(record: BinanceSquarePostItem) {
  const title = record.title?.trim();
  if (title && hasChineseText(title)) {
    return title;
  }

  const contentText = record.contentText?.trim();
  if (contentText && hasChineseText(contentText)) {
    return `${contentText.slice(0, 50)}${contentText.length > 50 ? "..." : ""}`;
  }

  if (title) {
    return title;
  }
  if (contentText) {
    return `${contentText.slice(0, 50)}${contentText.length > 50 ? "..." : ""}`;
  }

  return "(无标题)";
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDurationMs(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  const ms = Math.max(0, value);
  if (ms < 1000) return `${Math.round(ms)}毫秒`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}秒`;

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分${remainSeconds}秒`;
  }
  return `${minutes}分${remainSeconds.toString().padStart(2, "0")}秒`;
}

function statusTagColor(status?: string | null) {
  if (!status) return "default";
  if (status === "success" || status === "running") return "success";
  if (status === "partial") return "warning";
  if (status === "failed") return "error";
  return "default";
}

export function BinanceSquarePage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [seedForm] = Form.useForm();
  const [configForm] = Form.useForm();
  const [postsPage, setPostsPage] = useState(1);
  const [postsFilterUsername, setPostsFilterUsername] = useState("");
  const [postsFilterType, setPostsFilterType] = useState<string>();
  const [postsOrderBy, setPostsOrderBy] = useState("score");
  const [postsMinScore, setPostsMinScore] = useState("");
  const [logsPage, setLogsPage] = useState(1);
  const [logsTaskType, setLogsTaskType] = useState<string>();
  const [logsStatus, setLogsStatus] = useState<string>();
  const [targetRankSet, setTargetRankSet] = useState<BinanceSquareRankSet>("top1000");
  const [followingUser, setFollowingUser] = useState<string | null>(null);
  const [followingPage, setFollowingPage] = useState(1);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BinanceSquareConfigItem | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [rankPipelineOpen, setRankPipelineOpen] = useState(false);

  const statsQuery = useQuery({ queryKey: ["binance-square", "stats"], queryFn: fetchBinanceSquareStats, refetchInterval: 30_000 });
  const statusQuery = useQuery({ queryKey: ["binance-square", "status"], queryFn: fetchBinanceSquareStatus, refetchInterval: 15_000 });
  const progressQuery = useQuery({
    queryKey: ["binance-square", "progress"],
    queryFn: fetchBinanceSquareProgress,
    enabled: activeTab === "posts",
    refetchInterval: activeTab === "posts" ? 15_000 : false,
  });
  const targetProgressQuery = useQuery({
    queryKey: ["binance-square", "target-progress"],
    queryFn: fetchBinanceSquareTargetProgress,
    enabled: activeTab === "targets",
    refetchInterval: activeTab === "targets" ? 5_000 : false,
  });
  const userIntroProgressQuery = useQuery({
    queryKey: ["binance-square", "user-intro-progress"],
    queryFn: fetchBinanceSquareUserIntroProgress,
    enabled: activeTab === "targets",
    refetchInterval: activeTab === "targets" ? 5_000 : false,
  });
  const seedsQuery = useQuery({ queryKey: ["binance-square", "seeds"], queryFn: fetchBinanceSquareSeeds, enabled: activeTab === "seeds" });
  const targetsQuery = useQuery({
    queryKey: ["binance-square", "targets", targetRankSet],
    queryFn: () => fetchBinanceSquareTargets(targetRankSet),
    enabled: activeTab === "targets",
  });
  const configQuery = useQuery({ queryKey: ["binance-square", "config"], queryFn: fetchBinanceSquareConfig });
  const postsQuery = useQuery({
    queryKey: ["binance-square", "posts", postsPage, postsFilterUsername, postsFilterType, postsOrderBy, postsMinScore],
    queryFn: () =>
      fetchBinanceSquarePosts({
        page: postsPage,
        pageSize: 20,
        username: postsFilterUsername || undefined,
        postType: postsFilterType || undefined,
        orderBy: postsOrderBy,
        minScore: postsMinScore || undefined,
      }),
    enabled: activeTab === "posts",
  });
  const logsQuery = useQuery({
    queryKey: ["binance-square", "logs", logsPage, logsTaskType, logsStatus],
    queryFn: () =>
      fetchBinanceSquareLogs({
        page: logsPage,
        pageSize: 20,
        taskType: logsTaskType,
        status: logsStatus,
      }),
    enabled: activeTab === "overview" || activeTab === "logs",
  });
  const followingQuery = useQuery({
    queryKey: ["binance-square", "following", followingUser, followingPage],
    queryFn: () =>
      fetchBinanceSquareFollowingList({
        username: followingUser || "",
        page: followingPage,
        pageSize: 20,
      }),
    enabled: Boolean(followingUser),
  });

  const handleActionSuccess = (title: string, result?: BinanceSquareActionResult) => {
    messageApi.success(result?.message || `${title}已完成`);
    void Promise.all([
      statsQuery.refetch(),
      statusQuery.refetch(),
      progressQuery.refetch(),
      targetProgressQuery.refetch(),
      userIntroProgressQuery.refetch(),
      seedsQuery.refetch(),
      targetsQuery.refetch(),
      postsQuery.refetch(),
      logsQuery.refetch(),
    ]);
  };

  const calcTargetMutation = useMutation({
    mutationFn: calculateBinanceSquareTargets,
    onSuccess: (result) => handleActionSuccess("更新目标层级", result.data),
    onError: (error: Error) => messageApi.error(error.message || "计算失败"),
  });
  const userIntroMutation = useMutation({
    mutationFn: generateBinanceSquareUserIntros,
    onSuccess: (result) => handleActionSuccess("用户介绍生成", result.data),
    onError: (error: Error) => messageApi.error(error.message || "生成失败"),
  });
  const crawlMutation = useMutation({
    mutationFn: crawlBinanceSquarePosts,
    onSuccess: (result) => handleActionSuccess("帖子抓取", result.data),
    onError: (error: Error) => messageApi.error(error.message || "抓取失败"),
  });
  const startMutation = useMutation({
    mutationFn: startBinanceSquareScheduler,
    onSuccess: (result) => handleActionSuccess("启动调度器", result.data),
    onError: (error: Error) => messageApi.error(error.message || "启动失败"),
  });
  const pauseMutation = useMutation({
    mutationFn: pauseBinanceSquareScheduler,
    onSuccess: (result) => handleActionSuccess("暂停调度器", result.data),
    onError: (error: Error) => messageApi.error(error.message || "暂停失败"),
  });
  const stopMutation = useMutation({
    mutationFn: forceStopBinanceSquareCrawl,
    onSuccess: (result) => handleActionSuccess("强制终止", result.data),
    onError: (error: Error) => messageApi.error(error.message || "终止失败"),
  });
  const purgeSnapshotsMutation = useMutation({
    mutationFn: purgeBinanceSquareSnapshots,
    onSuccess: (result) => handleActionSuccess("清空旧镜像", result.data),
    onError: (error: Error) => messageApi.error(error.message || "清理失败"),
  });
  const resetTasksMutation = useMutation({
    mutationFn: resetBinanceSquareRunningTasks,
    onSuccess: (result) => handleActionSuccess("重置任务状态", result.data),
    onError: (error: Error) => messageApi.error(error.message || "重置失败"),
  });
  const recalcScoresMutation = useMutation({
    mutationFn: recalculateBinanceSquarePostScores,
    onSuccess: (result) => handleActionSuccess("补评分", result.data),
    onError: (error: Error) => messageApi.error(error.message || "补评分失败"),
  });
  const addSeedMutation = useMutation({
    mutationFn: addBinanceSquareSeed,
    onSuccess: () => {
      messageApi.success("已添加种子用户");
      seedForm.resetFields();
      void seedsQuery.refetch();
      void statsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "添加失败"),
  });
  const removeSeedMutation = useMutation({
    mutationFn: removeBinanceSquareSeed,
    onSuccess: () => {
      messageApi.success("已移除种子用户");
      void seedsQuery.refetch();
      void statsQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "移除失败"),
  });
  const syncSeedMutation = useMutation({
    mutationFn: syncBinanceSquareSeedFollowing,
    onSuccess: (result) => handleActionSuccess("单个种子同步", result.data),
    onError: (error: Error) => messageApi.error(error.message || "同步失败"),
  });
  const updateConfigMutation = useMutation({
    mutationFn: updateBinanceSquareConfig,
    onSuccess: () => {
      messageApi.success("配置已更新");
      setConfigModalOpen(false);
      setEditingConfig(null);
      configForm.resetFields();
      void configQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "配置更新失败"),
  });

  const stats = statsQuery.data?.data;
  const crawlStatus = statusQuery.data?.data;
  const progress = progressQuery.data?.data;
  const targetProgress = targetProgressQuery.data?.data;
  const userIntroProgress = userIntroProgressQuery.data?.data;
  const isStatusInitialLoading = statusQuery.isLoading && !crawlStatus;
  const seeds = seedsQuery.data?.data || [];
  const targets = targetsQuery.data?.data || [];
  const posts = postsQuery.data?.data;
  const logs = logsQuery.data?.data;
  const isLogsInitialLoading = logsQuery.isLoading && !logs;
  const configs = (configQuery.data?.data || []).filter((item) => !HIDDEN_CONFIG_KEYS.has(item.configKey));
  const followingData = followingQuery.data?.data;

  const seedColumns: ColumnsType<BinanceSquareSeedItem> = [
    { title: "用户名", dataIndex: "username", key: "username", width: 160, render: (value) => <strong>{value}</strong> },
    { title: "显示名", dataIndex: "displayName", key: "displayName", render: (value) => value || "-" },
    {
      title: "关注数",
      dataIndex: "totalFollowingCount",
      key: "totalFollowingCount",
      width: 100,
      render: (value, record) => (
        <Tooltip title={`当前有效关注关系数${record.apiTotalFollowingCount == null ? "" : `；API统计值：${record.apiTotalFollowingCount}`}`}>
          <a
            className="bs-following-link"
            onClick={() => {
              setFollowingUser(record.username);
              setFollowingPage(1);
            }}
          >
            {value ?? "-"}
          </a>
        </Tooltip>
      ),
    },
    { title: "最后同步", dataIndex: "lastFollowingSyncedAt", key: "lastFollowingSyncedAt", width: 170, render: formatDateTime },
    {
      title: "状态",
      key: "status",
      width: 90,
      render: (_, record) => (
        <span className={`bs-status-badge ${record.isActive !== false ? "bs-status-active" : "bs-status-inactive"}`}>
          {record.isActive !== false ? "活跃" : "停用"}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_, record) => (
        <div className="bs-table-actions">
          <LegacyActionButton
            size="small"
            compact
            variant="sync"
            loading={syncSeedMutation.isPending}
            onClick={() => syncSeedMutation.mutate(record.username)}
          >
            同步
          </LegacyActionButton>
          <Popconfirm title="确认移除该种子用户？" onConfirm={() => removeSeedMutation.mutate(record.username)}>
            <LegacyActionButton
              size="small"
              compact
              variant="remove"
              danger
              loading={removeSeedMutation.isPending}
            >
              移除
            </LegacyActionButton>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const targetColumns: ColumnsType<BinanceSquareTargetRankItem> = [
    {
      title: "层级",
      dataIndex: "rankSet",
      key: "rankSet",
      width: 95,
      render: (value) => <Tag color={value === "top1000" ? "gold" : "blue"}>{value || targetRankSet}</Tag>,
    },
    {
      title: "排名",
      dataIndex: "rank",
      key: "rank",
      width: 80,
      render: (value: number) => <span style={{ fontWeight: 700, color: value <= 3 ? "#f59e0b" : "#64748b" }}>#{value}</span>,
    },
    { title: "Handler", dataIndex: "username", key: "username", width: 180, render: (value) => <strong>{value}</strong> },
    {
      title: "用户名字",
      dataIndex: "displayName",
      key: "displayName",
      width: 180,
      render: (value) => value || "-",
    },
    {
      title: "双语介绍",
      dataIndex: "aiOneLineIntro",
      key: "aiOneLineIntro",
      width: 460,
      render: (value, record) => {
        const intro = parseBilingualIntro(value);
        if (intro.isValid) {
          return (
            <Tooltip title={intro.raw}>
              <div className="bs-bilingual-intro-cell">
                <div className="bs-bilingual-intro-zh">{intro.zh}</div>
                <div className="bs-bilingual-intro-en">{intro.en}</div>
              </div>
            </Tooltip>
          );
        }
        if (intro.raw && record.aiIntroStatus === "success") {
          return <Tooltip title={intro.raw}><Tag color="orange">格式异常</Tag></Tooltip>;
        }
        if (record.aiIntroStatus === "failed") {
          return <Tooltip title={record.aiIntroError || "生成失败"}><Tag color="red">生成失败</Tag></Tooltip>;
        }
        if (record.aiIntroStatus === "running") {
          return <Tag color="blue">生成中</Tag>;
        }
        return <Tag>未生成</Tag>;
      },
    },
    {
      title: "被关注次数",
      dataIndex: "followerCount",
      key: "followerCount",
      width: 160,
      render: (value, record) => {
        const sourceFollowers = record.sourceFollowers || record.seedFollowers || [];
        const seedNames = sourceFollowers.map((item) => item.displayName || item.username).join(", ");
        return (
          <span title={seedNames ? `来源关注者：${seedNames}` : undefined} style={{ cursor: seedNames ? "help" : "default" }}>
            {value ?? 0} 个来源关注
          </span>
        );
      },
    },
    {
      title: "命中层",
      dataIndex: "includedRankSets",
      key: "includedRankSets",
      width: 180,
      render: (value?: string[] | null) => (
        <div className="bs-rankset-tags">
          {(value?.length ? value : [targetRankSet]).map((rankSet) => (
            <Tag key={rankSet}>{rankSet}</Tag>
          ))}
        </div>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_, record) => (
        <div className="bs-table-actions">
          {[
            ["帖子", "article"],
            ["回复", "reply"],
            ["引用", "quote"],
          ].map(([label, type]) => (
            <LegacyActionButton
              key={type}
              size="small"
              compact
              variant="view"
              onClick={() => {
                setPostsFilterUsername(record.username);
                setPostsFilterType(type);
                setPostsPage(1);
                setActiveTab("posts");
              }}
            >
              {label}
            </LegacyActionButton>
          ))}
        </div>
      ),
    },
  ];

  const postColumns: ColumnsType<BinanceSquarePostItem> = [
    {
      title: "分数",
      dataIndex: "score",
      key: "score",
      width: 90,
      render: (value) => <strong className="bs-score-cell">{typeof value === "number" ? value.toFixed(4) : "-"}</strong>,
    },
    { title: "类型", dataIndex: "postType", key: "postType", width: 90, render: (value) => <span className={`bs-log-type ${value === "article" ? "bs-log-type-post" : value === "reply" ? "bs-log-type-following" : "bs-log-type-target"}`}>{value || "-"}</span> },
    { title: "用户名", dataIndex: "username", key: "username", width: 150 },
    {
      title: "标题",
      key: "content",
      render: (_, record) => {
        const chineseTitle = getChinesePostTitle(record);
        return (
          <Typography.Link
            className="bs-post-title-link"
            href={record.sourceUrl || record.postUrl || undefined}
            target="_blank"
            title={chineseTitle}
          >
            {chineseTitle}
          </Typography.Link>
        );
      },
    },
    { title: "点赞", dataIndex: "likeCount", key: "likeCount", width: 80, render: (value) => <Tooltip title={value ?? "-"}>{formatCompactNumber(value)}</Tooltip> },
    { title: "评论", dataIndex: "commentCount", key: "commentCount", width: 80, render: (value) => <Tooltip title={value ?? "-"}>{formatCompactNumber(value)}</Tooltip> },
    { title: "分享", dataIndex: "shareCount", key: "shareCount", width: 80, render: (value) => <Tooltip title={value ?? "-"}>{formatCompactNumber(value)}</Tooltip> },
    { title: "浏览", dataIndex: "viewCount", key: "viewCount", width: 80, render: (value) => <Tooltip title={value ?? "-"}>{formatCompactNumber(value)}</Tooltip> },
    { title: "评分时间", dataIndex: "lastScoredAt", key: "lastScoredAt", width: 170, render: formatDateTime },
    { title: "发布时间", dataIndex: "publishedAt", key: "publishedAt", width: 170, render: formatDateTime },
  ];

  const logColumns: ColumnsType<BinanceSquareCrawlLogItem> = [
    { title: "时间", dataIndex: "createdAt", key: "createdAt", width: 170, render: formatDateTime },
    { title: "任务类型", dataIndex: "taskType", key: "taskType", width: 140, render: (value) => <span className={`bs-log-type ${value === "following" ? "bs-log-type-following" : value === "post" ? "bs-log-type-post" : "bs-log-type-target"}`}>{value || "-"}</span> },
    { title: "状态", dataIndex: "status", key: "status", width: 90, render: (value) => <Tag color={statusTagColor(value)}>{value || "-"}</Tag> },
    { title: "目标", dataIndex: "targetId", key: "targetId", width: 140, render: (value) => value || "-" },
    { title: "数量", dataIndex: "itemsCount", key: "itemsCount", width: 90, render: (value) => value ?? "-" },
    { title: "耗时", dataIndex: "durationMs", key: "durationMs", width: 110, render: formatDurationMs },
    { title: "抓取批次", dataIndex: "snapshotId", key: "snapshotId", width: 150, render: (value) => value || "-" },
  ];

  const followingColumns: ColumnsType<BinanceSquareFollowingUser> = [
    {
      title: "用户名",
      dataIndex: "followingUsername",
      key: "followingUsername",
      width: 180,
      render: (value) => <strong>{value || "-"}</strong>,
    },
    { title: "显示名", dataIndex: "displayName", key: "displayName", render: (value) => value || "-" },
    {
      title: "状态",
      dataIndex: "isActive",
      key: "isActive",
      width: 90,
      render: (value) => <Tag color={value === false ? "default" : "success"}>{value === false ? "失效" : "有效"}</Tag>,
    },
    { title: "粉丝数", dataIndex: "totalFollowerCount", key: "totalFollowerCount", width: 100, render: (value) => value ?? "-" },
    { title: "帖子数", dataIndex: "totalPostCount", key: "totalPostCount", width: 100, render: (value) => value ?? "-" },
    { title: "最近看到", dataIndex: "lastSeenAt", key: "lastSeenAt", width: 170, render: formatDateTime },
  ];

  return (
    <PermissionGuard permission="binance-square">
      {contextHolder}
      <div className="binance-square-page" id="binance-square-section">
        <h2 className="section-title">币安广场爬虫管理</h2>
        <p className="section-desc">Seed 关注同步 → Top50/100/300/1000 分阶段扩展 → Top1000 近7天 ALL+REPLY 抓取 → 热度评分排序</p>

        <div className="bs-stats-grid">
          {[
            ["种子用户", stats?.seedCount || 0, "#3b82f6"],
            ["最终目标", stats?.targetCount || 0, "#f59e0b"],
            ["帖子总数", formatCompactNumber(stats?.postCount), "#10b981"],
            ["上次抓取", stats?.lastCrawlAt ? dayjs(stats.lastCrawlAt).format("HH:mm") : "-", "#64748b"],
            ["调度器状态", isStatusInitialLoading ? "加载中…" : crawlStatus?.isRunning ? "运行中" : "已暂停", isStatusInitialLoading ? "#94a3b8" : crawlStatus?.isRunning ? "#10b981" : "#ef4444"],
          ].map(([label, value, color]) => (
            <LegacyMetricCard
              key={String(label)}
              label={label}
              value={value}
              indicatorColor={String(color)}
            />
          ))}
        </div>

        <div className="bs-actions-bar">
          <LegacyActionButton
            variant="primary"
            loading={crawlMutation.isPending}
            onClick={() => crawlMutation.mutate({ mode: "full", daysBack: 7, concurrency: 2, filterTypes: ["ALL", "REPLY"] })}
          >
            抓取近7天
          </LegacyActionButton>
          <Popconfirm
            title="确认补评分？"
            description="将重算 Top1000 目标用户近7天帖子热度分。适合爬虫中途崩溃、已入库但未完成最终评分时使用。"
            okText="开始补评分"
            cancelText="取消"
            onConfirm={() => recalcScoresMutation.mutate({ daysBack: 7, targetOnly: true })}
          >
            <LegacyActionButton variant="warning" loading={recalcScoresMutation.isPending}>
              补评分
            </LegacyActionButton>
          </Popconfirm>
          <LegacyActionButton variant="success" loading={startMutation.isPending} onClick={() => startMutation.mutate()}>
            启动调度器
          </LegacyActionButton>
          <LegacyActionButton variant="danger" loading={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>
            暂停调度器
          </LegacyActionButton>
          {crawlStatus?.isCrawling ? (
            <LegacyActionButton variant="danger" loading={stopMutation.isPending} onClick={() => stopMutation.mutate()}>
              强制终止
            </LegacyActionButton>
          ) : null}
          <Popconfirm
            title="确认重置所有运行中任务状态？"
            description="会清理帖子抓取、目标用户更新、介绍生成的 Redis 锁和进度，并给帖子爬虫发送停止信号。仅在任务卡死或进程异常退出后使用。"
            okText="确认重置"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => resetTasksMutation.mutate()}
          >
            <LegacyActionButton variant="danger" loading={resetTasksMutation.isPending}>
              重置任务状态
            </LegacyActionButton>
          </Popconfirm>
          <LegacyActionButton
            variant="neutral"
            onClick={() => {
              void statsQuery.refetch();
              void statusQuery.refetch();
              void progressQuery.refetch();
              void targetProgressQuery.refetch();
              void userIntroProgressQuery.refetch();
              void seedsQuery.refetch();
              void targetsQuery.refetch();
              void postsQuery.refetch();
              void logsQuery.refetch();
              void configQuery.refetch();
            }}
          >
            刷新数据
          </LegacyActionButton>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          className="bs-sub-tabs-react"
          items={[
            {
              key: "overview",
              label: "总览",
              children: (
                <div className="bs-sub-panel-react">
                  <div className="bs-panel-title">爬虫运行概览</div>
                  <div className="bs-overview-grid">
                    <div className="bs-overview-card bs-config-card">
                      <h4>配置参数</h4>
                      <div className="bs-config-list">
                        {configs.length ? configs.map((item) => {
                          const help = getConfigHelp(item.configKey);
                          return (
                            <div className="bs-config-item" key={item.configKey}>
                              <div className="bs-config-copy">
                                <span className="bs-config-label">
                                  {help.label}
                                  <Tooltip
                                    placement="right"
                                    title={
                                      <div className="bs-config-tooltip">
                                        <div>{help.desc}</div>
                                        {help.tip ? <div className="bs-config-tooltip-tip">{help.tip}</div> : null}
                                      </div>
                                    }
                                  >
                                    <InfoCircleOutlined className="bs-config-info-icon" />
                                  </Tooltip>
                                </span>
                                <code className="bs-config-key">{item.configKey}</code>
                              </div>
                              <span className="bs-config-val">
                                {item.configValue}{item.unit ? ` ${item.unit}` : ""}
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    setEditingConfig(item);
                                    configForm.setFieldsValue({ configValue: item.configValue });
                                    setConfigModalOpen(true);
                                  }}
                                >
                                  修改
                                </Button>
                              </span>
                            </div>
                          );
                        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置项" />}
                      </div>
                      <div className="bs-hidden-maintenance">
                        <Popconfirm
                          title="确认清空旧镜像数据？"
                          description="只清空 BinanceSquarePostSnapshots 历史数据，保留表结构；新版本不再写完整镜像。"
                          okText="确认清空"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => purgeSnapshotsMutation.mutate()}
                        >
                          <Button
                            type="link"
                            size="small"
                            danger
                            loading={purgeSnapshotsMutation.isPending}
                          >
                            清空旧镜像数据
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                    <div className="bs-overview-card">
                      <h4>最近抓取统计</h4>
                      {isStatusInitialLoading ? (
                        <div className="bs-loading-state">
                          <Spin size="small" />
                          <span>正在获取调度器状态…</span>
                        </div>
                      ) : (
                        <Descriptions size="small" column={1}>
                          <Descriptions.Item label="调度器">{crawlStatus?.isRunning ? "运行中" : "已暂停"}</Descriptions.Item>
                          <Descriptions.Item label="当前抓取">{crawlStatus?.isCrawling ? "执行中" : "空闲"}</Descriptions.Item>
                          <Descriptions.Item label="抓取窗口">{crawlStatus?.postCrawlDaysBack || 7} 天 / {crawlStatus?.postCrawlFilterTypes || "ALL,REPLY"}</Descriptions.Item>
                          <Descriptions.Item label="冷却时间">{crawlStatus?.postCrawlCooldownMinutes ?? 30} 分钟</Descriptions.Item>
                          <Descriptions.Item label="最近任务状态">{crawlStatus?.lastCrawl?.status || "-"}</Descriptions.Item>
                          <Descriptions.Item label="最近任务时间">{formatDateTime(crawlStatus?.lastCrawl?.createdAt)}</Descriptions.Item>
                        </Descriptions>
                      )}
                    </div>
                    <div className="bs-overview-card">
                      <h4>最近日志</h4>
                      <div className="bs-recent-logs">
                        {isLogsInitialLoading ? (
                          <div className="bs-loading-state">
                            <Spin size="small" />
                            <span>正在加载最近抓取日志…</span>
                          </div>
                        ) : logs?.data?.length ? logs.data.slice(0, 6).map((log) => (
                          <div className="bs-recent-log-item" key={log.id}>
                            <span>
                              <span className={`bs-log-type ${log.taskType === "following" ? "bs-log-type-following" : log.taskType === "post" ? "bs-log-type-post" : "bs-log-type-target"}`}>
                                {log.taskType}
                              </span>
                              <span className={`bs-log-status-${log.status}`} style={{ marginLeft: 8 }}>{log.status}</span>
                            </span>
                            <span className="bs-log-time">{formatDateTime(log.createdAt)}</span>
                          </div>
                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />}
                      </div>
                    </div>
                  </div>
                </div>
              ),
            },
              {
                key: "seeds",
                label: "种子用户",
                children: (
                  <div className="bs-sub-panel-react">
                    <div className="bs-panel-title">种子用户管理</div>
                    <div className="bs-seed-add-row">
                      <Form form={seedForm} layout="inline" onFinish={(values) => addSeedMutation.mutate(values)} className="bs-inline-form">
                        <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                          <Input placeholder="用户名（如 CZ）" />
                        </Form.Item>
                        <Form.Item name="displayName">
                          <Input placeholder="显示名（可选）" />
                        </Form.Item>
                        <Form.Item>
                          <LegacyActionButton variant="primary" htmlType="submit" loading={addSeedMutation.isPending}>
                            添加
                          </LegacyActionButton>
                        </Form.Item>
                      </Form>
                    </div>
                    <Table size="small" rowKey="username" columns={seedColumns} dataSource={seeds} pagination={false} scroll={{ y: TABLE_MAX_HEIGHT }} />
                  </div>
                ),
              },
              {
                key: "targets",
                label: "目标用户",
                children: (
                  <div className="bs-sub-panel-react">
                    <div className="bs-panel-title-row">
                      <div>
                        <div className="bs-panel-title">目标用户列表</div>
                        <div className="bs-panel-subtitle">低频的 Top50/100/300/1000 分阶段更新已默认折叠。</div>
                      </div>
                      <Button size="small" onClick={() => setRankPipelineOpen((open) => !open)}>
                        {rankPipelineOpen ? "收起低频更新" : "展开低频更新"}
                      </Button>
                    </div>
                    {rankPipelineOpen ? (
                      <>
                        <div className="bs-rank-pipeline">
                          {RANK_STAGES.map((stage, index) => (
                            <div className={`bs-rank-stage ${targetRankSet === stage.key ? "is-active" : ""}`} key={stage.key}>
                              <button
                                type="button"
                                className="bs-rank-stage-main"
                                onClick={() => setTargetRankSet(stage.key)}
                              >
                                <span className="bs-rank-stage-index">{index + 1}</span>
                                <span>
                                  <strong>{stage.label}</strong>
                                  <em>{stage.source} → {stage.label}</em>
                                </span>
                              </button>
                              <p>{stage.desc}</p>
                              <Button
                                size="small"
                                className={`bs-rank-stage-update ${stage.key === "top1000" ? "is-final" : ""}`}
                                loading={calcTargetMutation.isPending && calcTargetMutation.variables === stage.key}
                                disabled={Boolean(targetProgress?.running)}
                                onClick={() => calcTargetMutation.mutate(stage.key)}
                              >
                                更新 {stage.label}
                              </Button>
                            </div>
                          ))}
                        </div>
                        <Alert
                          type="info"
                          showIcon
                          className="bs-stage-alert"
                          message="需要按 Top50 → Top100 → Top300 → Top1000 顺序更新"
                          description="每一步会自动同步上一层用户的关注列表；Top1000 会合并 Top50/100/300，最终写入 isTargetUser。"
                        />
                      </>
                    ) : null}
                    {targetProgress?.latest ? (
                      <div className={`bs-target-progress ${targetProgress.running ? "is-running" : ""}`}>
                        <div className="bs-progress-header">
                          <span className="bs-progress-status">
                            {targetProgress.running ? "目标用户更新中" : "最近目标更新"}
                            {targetProgress.latest.rankSet ? ` · ${targetProgress.latest.rankSet}` : ""}
                          </span>
                          <span className="bs-progress-stats">
                            {targetProgress.latest.processedSourceUsers || 0}/{targetProgress.latest.totalSourceUsers || 0}
                          </span>
                        </div>
                        <Progress
                          percent={targetProgress.latest.totalSourceUsers ? Math.round(((targetProgress.latest.processedSourceUsers || 0) / targetProgress.latest.totalSourceUsers) * 100) : 0}
                          showInfo={false}
                          size="small"
                          status={targetProgress.latest.status === "failed" ? "exception" : targetProgress.running ? "active" : "success"}
                        />
                        <div className="bs-progress-detail">
                          <span>阶段: {targetProgress.latest.stage || "-"}</span>
                          <span>当前: {targetProgress.latest.currentSourceUser || "-"}</span>
                          <span>候选: {targetProgress.latest.candidateCount || 0}</span>
                          <span>入榜: {targetProgress.latest.rankedCount || 0}</span>
                          <span>关系: {targetProgress.latest.totalRelations || 0}</span>
                          <span>更新: {formatDateTime(targetProgress.latest.updatedAt)}</span>
                        </div>
                        {targetProgress.latest.errorMessage ? (
                          <div className="bs-progress-error">{targetProgress.latest.errorMessage}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {userIntroProgress?.latest ? (
                      <div className={`bs-target-progress ${userIntroProgress.running ? "is-running" : ""}`}>
                        <div className="bs-progress-header">
                          <span className="bs-progress-status">
                            {userIntroProgress.running ? "Top100 用户介绍生成中" : "最近用户介绍生成"}
                          </span>
                          <span className="bs-progress-stats">
                            {(userIntroProgress.latest.processed || 0)}/{userIntroProgress.latest.total || 0}
                          </span>
                        </div>
                        <Progress
                          percent={userIntroProgress.latest.total ? Math.round(((userIntroProgress.latest.processed || 0) / userIntroProgress.latest.total) * 100) : 0}
                          showInfo={false}
                          size="small"
                          status={userIntroProgress.latest.status === "failed" ? "exception" : userIntroProgress.running ? "active" : "success"}
                        />
                        <div className="bs-progress-detail">
                          <span>成功: {userIntroProgress.latest.success || 0}</span>
                          <span>跳过: {userIntroProgress.latest.skipped || 0}</span>
                          <span style={{ color: "#ef4444" }}>失败: {userIntroProgress.latest.failed || 0}</span>
                          <span>当前: {userIntroProgress.latest.currentUsername || "-"}</span>
                          <span>并发: {userIntroProgress.latest.concurrency || "-"}</span>
                          <span>更新: {formatDateTime(userIntroProgress.latest.updatedAt)}</span>
                        </div>
                        {userIntroProgress.latest.errorMessage ? (
                          <div className="bs-progress-error">{userIntroProgress.latest.errorMessage}</div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="bs-target-toolbar">
                      <Select
                        value={targetRankSet}
                        onChange={(value) => setTargetRankSet(value as BinanceSquareRankSet)}
                        options={RANK_STAGES.map((stage) => ({ label: stage.label, value: stage.key }))}
                      />
                      <Popconfirm
                        title="生成 Top100 用户介绍？"
                        description="会读取 Top1000 前100名用户的 profile 和最近最多50篇帖子，调用大模型生成中文30-70字+英文一句的双语介绍；已有且输入未变化的会自动跳过。"
                        okText="开始生成"
                        cancelText="取消"
                        onConfirm={() => userIntroMutation.mutate({ rankSet: "top1000", limit: 100, postLimit: 50, force: false })}
                      >
                        <LegacyActionButton variant="primary" loading={userIntroMutation.isPending} disabled={Boolean(userIntroProgress?.running)}>
                          生成Top100介绍
                        </LegacyActionButton>
                      </Popconfirm>
                      <LegacyActionButton variant="neutral" onClick={() => void targetsQuery.refetch()}>
                        刷新当前层
                      </LegacyActionButton>
                    </div>
                    <Table
                      size="small"
                      rowKey={(record) => `${record.rankSet || targetRankSet}-${record.username}`}
                      columns={targetColumns}
                      dataSource={targets}
                      pagination={false}
                      scroll={{ y: TABLE_MAX_HEIGHT, x: 1400 }}
                      loading={targetsQuery.isFetching}
                    />
                  </div>
                ),
              },
              {
                key: "posts",
                label: "帖子列表",
                children: (
                  <div className="bs-sub-panel-react">
                    <div className="bs-panel-title">帖子列表</div>
                    {progress?.running ? (
                      <div className="bs-crawl-progress">
                        <div className="bs-progress-header">
                          <span className="bs-progress-status">{progress.message || "正在抓取..."}</span>
                          <span className="bs-progress-stats">{`${progress.processedUsers || 0}/${progress.totalUsers || 0}`}</span>
                        </div>
                        <Progress
                          percent={progress.totalUsers ? Math.round(((progress.processedUsers || 0) / progress.totalUsers) * 100) : 0}
                          showInfo={false}
                          size="small"
                        />
                        <div className="bs-progress-detail">
                          <span>成功: {progress.successUsers || 0}</span>
                          <span style={{ color: "#ef4444" }}>失败: {progress.failedUsers || 0}</span>
                          <span>出错率: {progress.errorRate || 0}%</span>
                          <span>ALL: {progress.totalPostsAll || 0}</span>
                          <span>REPLY: {progress.totalPostsReply || 0}</span>
                          <span>入库: {progress.totalUpsertedPosts || 0}</span>
                          <span>评分: {progress.scoredPosts || 0}</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="bs-posts-filter">
                      <Input
                        placeholder="筛选用户名"
                        value={postsFilterUsername}
                        onChange={(event) => setPostsFilterUsername(event.target.value)}
                        onPressEnter={() => setPostsPage(1)}
                      />
                      <Select
                        allowClear
                        placeholder="全部类型"
                        value={postsFilterType}
                        onChange={(value) => { setPostsFilterType(value); setPostsPage(1); }}
                        options={[
                          { label: "文章", value: "article" },
                          { label: "引用", value: "quote" },
                          { label: "回复", value: "reply" },
                        ]}
                      />
                      <Select
                        value={postsOrderBy}
                        onChange={(value) => { setPostsOrderBy(value); setPostsPage(1); }}
                        options={[
                          { label: "按热度分", value: "score" },
                          { label: "按发布时间", value: "publishedAt" },
                          { label: "按浏览", value: "viewCount" },
                          { label: "按分享", value: "shareCount" },
                          { label: "按评论", value: "commentCount" },
                          { label: "按点赞", value: "likeCount" },
                        ]}
                      />
                      <Input
                        placeholder="最低分"
                        value={postsMinScore}
                        onChange={(event) => setPostsMinScore(event.target.value)}
                        onPressEnter={() => setPostsPage(1)}
                      />
                      <LegacyActionButton variant="neutral" onClick={() => { setPostsPage(1); void postsQuery.refetch(); }}>筛选</LegacyActionButton>
                    </div>
                    <Table
                      size="small"
                      rowKey={(record) => String(record.id)}
                      columns={postColumns}
                      dataSource={posts?.data || []}
                      pagination={false}
                      scroll={{ y: TABLE_MAX_HEIGHT, x: 1200 }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Pagination
                        current={posts?.page || 1}
                        pageSize={posts?.pageSize || 20}
                        total={posts?.total || 0}
                        showSizeChanger={false}
                        onChange={(page) => setPostsPage(page)}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: "logs",
                label: "抓取日志",
                children: (
                  <div className="bs-sub-panel-react">
                    <div className="bs-panel-title">抓取日志</div>
                    <div className="bs-logs-filter">
                      <Select
                        allowClear
                        placeholder="全部类型"
                        value={logsTaskType}
                        onChange={(value) => { setLogsTaskType(value); setLogsPage(1); }}
                        options={[
                          { label: "关注同步", value: "following" },
                          { label: "帖子抓取", value: "post" },
                          { label: "目标计算", value: "target_calculate" },
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="全部状态"
                        value={logsStatus}
                        onChange={(value) => { setLogsStatus(value); setLogsPage(1); }}
                        options={[
                          { label: "运行中", value: "running" },
                          { label: "成功", value: "success" },
                          { label: "失败", value: "failed" },
                          { label: "部分成功", value: "partial" },
                        ]}
                      />
                      <LegacyActionButton variant="neutral" onClick={() => void logsQuery.refetch()}>刷新</LegacyActionButton>
                    </div>
                    <Table size="small" rowKey="id" columns={logColumns} dataSource={logs?.data || []} pagination={false} loading={logsQuery.isFetching} scroll={{ y: TABLE_MAX_HEIGHT, x: 1000 }} />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Pagination
                        current={logs?.page || 1}
                        pageSize={logs?.pageSize || 20}
                        total={logs?.total || 0}
                        showSizeChanger={false}
                        onChange={(page) => setLogsPage(page)}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />

          {statsQuery.isError || statusQuery.isError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 16 }}
              message="币安广场数据加载存在异常"
              description="请检查数据库迁移、接口权限或后端服务状态。"
            />
          ) : null}

        <Drawer
          title={followingUser ? `${followingUser} 的关注列表` : "关注列表"}
          width={720}
          open={Boolean(followingUser)}
          onClose={() => setFollowingUser(null)}
        >
          <Table
            rowKey={(record) => `${record.followingUsername}-${record.createdAt}`}
            columns={followingColumns}
            dataSource={followingData?.data || []}
            loading={followingQuery.isFetching}
            pagination={false}
            size="small"
            scroll={{ y: 520 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Pagination
              current={followingData?.page || 1}
              pageSize={followingData?.pageSize || 20}
              total={followingData?.total || 0}
              showSizeChanger={false}
              onChange={(page) => setFollowingPage(page)}
            />
          </div>
        </Drawer>

        <Modal
          title={editingConfig ? `修改配置：${editingConfig.configKey}` : "修改配置"}
          open={configModalOpen}
          onCancel={() => {
            setConfigModalOpen(false);
            setEditingConfig(null);
            configForm.resetFields();
          }}
          onOk={() => {
            void configForm.validateFields().then((values) => {
              if (!editingConfig) return;
              updateConfigMutation.mutate({
                configKey: editingConfig.configKey,
                configValue: String(values.configValue),
              });
            });
          }}
          confirmLoading={updateConfigMutation.isPending}
        >
          <Form form={configForm} layout="vertical">
            <Form.Item label="配置值" name="configValue" rules={[{ required: true, message: "请输入配置值" }]}>
              <Input />
            </Form.Item>
            {editingConfig ? (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="中文名">{getConfigHelp(editingConfig.configKey).label}</Descriptions.Item>
                <Descriptions.Item label="说明">{getConfigHelp(editingConfig.configKey).desc}</Descriptions.Item>
                <Descriptions.Item label="建议">{getConfigHelp(editingConfig.configKey).tip || editingConfig.description || "-"}</Descriptions.Item>
                <Descriptions.Item label="范围">
                  {editingConfig.minValue ?? "-"} ~ {editingConfig.maxValue ?? "-"}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </Form>
        </Modal>
      </div>
    </PermissionGuard>
  );
}
