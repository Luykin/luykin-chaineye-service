import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  CopyOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchNacosAdminConfig,
  fetchNacosAdminConfigHistory,
  fetchNacosAdminConfigSnapshot,
  publishNacosAdminConfig,
  suggestCleanerRegexWithAi,
} from "@/services/nacos";
import type {
  CleanerAiRegexSuggestion,
  CleanerRemoteConfig,
  CleanerRuleGroup,
  NacosAdminConfigSnapshot,
} from "@/types/nacos";

const { TextArea } = Input;
const { Title, Text, Paragraph } = Typography;

const CLEANER_DATA_ID = "xhunt_cleaner_rules";
const DEFAULT_GROUP = "DEFAULT_GROUP";

// 离线兜底内置默认规则
const DEFAULT_CLEANER_CONFIG: CleanerRemoteConfig = {
  version: 2026091501,
  enabled: true,
  updateTime: "2026-09-15T00:00:00Z",
  description: "XHunt 信息流智能降噪与黄推/灰产引流过滤规则",
  rules: {
    adult_traffic: {
      name: "黄推与色情引流",
      enabled: true,
      maxWeakSpamLength: 80,
      strongKeywords: [
        "我福不黑", "福不黑", "服不黑", "批不黑", "逼不黑",
        "看置顶推文", "私聊看完整", "看主页置顶", "看主页有惊喜",
        "同城约v", "门槛群", "可约可空降", "同城品茶", "看简界",
        "私我看片", "主页有福利", "无门槛福利", "看主页置顶推文",
        "私我进群", "同城约拍", "同城安排", "加v看", "加微看",
        "福利视频", "免费看片", "高清无码", "主页置顶群", "主页自取",
        "吃瓜合集", "修车资源", "同城交友v", "私信领福利", "加主页微信",
        "同城可空降", "全国空降", "同城约妹", "门槛进群", "看置顶进群"
      ],
      intentKeywords: [
        "主页", "置顶", "私信", "私聊", "私我", "加v", "加微", "加我",
        "微", "vx", "进群", "门槛", "完整", "约v", "约微", "空降",
        "自取", "领福利", "福利", "资源", "联系方式", "安排", "简界"
      ],
      exactKeywords: [
        "18禁", "AV女优", "adult", "a片", "乱伦", "偷拍", "全裸",
        "口交", "情趣用品", "成人片", "手淫", "抽插", "援交", "操逼", "品茶"
      ],
      fuzzyKeywords: [
        "约v", "约微", "看置顶", "看主页", "门槛群", "私聊看", "吃瓜群",
        "喝茶资源", "同城约", "私我看", "主页福利", "看简界", "品茶", "空降"
      ],
      regexPatterns: [
        "(?:我|自[己称])?(?:福|服|批|逼)不黑",
        "(?:锐评|评价|点评|看看).{0,6}(?:我的)?(?:福|服|批|逼)",
        "比我(?:好看|美).{0,6}没我(?:骚|浪|色|涩)",
        "(加|威|微|v|V|vx|VX)[：:号信➕\\s]{1,3}[a-zA-Z0-9_-]{5,}",
        "(约|找)[妹女炮vV].{0,6}(看|戳|点|进).{0,4}(主页|置顶|简界)",
        "(同城|空降|包夜|品茶|约[炮妹vV微]).{0,8}(私聊|加我|微|vx|v|主页|置顶)",
        "t\\.me/[a-zA-Z0-9_+]{4,}"
      ],
    },
    gray_promotion: {
      name: "灰产与博彩引流",
      enabled: true,
      maxWeakSpamLength: 80,
      strongKeywords: [
        "带单回血", "稳赚不赔", "精准计划", "兼职刷单", "日赚过千",
        "包赔带单", "带单老师", "一对一指导", "稳赚计划", "回血上岸",
        "带你回血", "内部计划群", "高胜率计划", "日赚上万", "包赔跟单"
      ],
      intentKeywords: [
        "群", "导师", "私信", "私聊", "带单", "回血", "上岸", "跟单", "内部"
      ],
      exactKeywords: ["回血", "带单", "精准计划", "包赔"],
      fuzzyKeywords: ["回血", "带单", "内部计划", "日赚", "稳赚", "上岸计划", "兼职日结"],
      regexPatterns: [
        "(带单|跟单|回血).{0,6}(加|找|进).{0,4}(群|导师|私信)",
        "彩票.{0,4}(计划|稳赢|内幕)"
      ],
    },
  },
  globalExemptHandles: ["x", "support", "twitter", "xhunt_ai", "elonmusk", "cz_binance"],
};

// 文本抗混淆清洗算法（复刻自插件客户端，保证沙箱检测结果 100% 一致）
function normalizeSandboxText(raw: string): { normalized: string; stripped: string } {
  if (!raw) return { normalized: "", stripped: "" };
  let s = raw.normalize("NFKC");
  // 零宽字符、Word Joiner、软连字符
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, "");
  // Emoji
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  // 干扰标点
  const stripped = s.replace(/[\s\-_.,!?:;"'()\[\]{}<>~`*^%$#@\/\\|+=—–·…“”‘’]/g, "");
  return { normalized: s, stripped };
}


const AI_SAMPLE_PRESETS = [
  {
    label: "微信/联系方式引流",
    text: "私信我看完整无码合集福利，加微: abc_8888",
  },
  {
    label: "置顶推文门槛群",
    text: "想看更多高清自拍移步我主页置顶，门槛群自取福利，可约可空降",
  },
  {
    label: "Telegram/纸飞机导流",
    text: "老司机进内部吃瓜裙，TG纸飞机搜索: @sweet_girl66 免费自取",
  },
  {
    label: "同城品茶约拍",
    text: "全国一二线同城可空降品茶安排，加主页v看简界照片预约",
  },
];

export function NacosCleanerRulesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<string>("adult_traffic");
  const [config, setConfig] = useState<CleanerRemoteConfig>(DEFAULT_CLEANER_CONFIG);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishReason, setPublishReason] = useState("");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  // 批量添加弹窗状态
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchTargetField, setBatchTargetField] = useState<
    "strongKeywords" | "intentKeywords" | "exactKeywords" | "fuzzyKeywords" | "globalExemptHandles"
  >("strongKeywords");
  const [batchInputText, setBatchInputText] = useState("");

  // 正则新增/编辑弹窗
  const [regexModalVisible, setRegexModalVisible] = useState(false);
  const [regexInput, setRegexInput] = useState("");
  const [regexEditIndex, setRegexEditIndex] = useState<number | null>(null);
  const [regexModalTab, setRegexModalTab] = useState<"ai" | "manual">("ai");

  // AI 正则生成状态
  const [aiSampleText, setAiSampleText] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<CleanerAiRegexSuggestion[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [selectedAiPatterns, setSelectedAiPatterns] = useState<string[]>([]);

  // 沙箱测试器状态
  const [sandboxAuthor, setSandboxAuthor] = useState("");
  const [sandboxTweetText, setSandboxTweetText] = useState("");
  const [sandboxResult, setSandboxResult] = useState<{
    tested: boolean;
    matched: boolean;
    category?: string;
    ruleName?: string;
    reason?: string;
    matchedWord?: string;
    costMs?: number;
  }>({ tested: false, matched: false });

  // 1. 查询线上 Nacos 配置
  const configQuery = useQuery({
    queryKey: ["nacos-cleaner-config"],
    queryFn: async () => {
      const resp = await fetchNacosAdminConfig({ dataId: CLEANER_DATA_ID, group: DEFAULT_GROUP });
      if (!resp.success || !resp.data) {
        throw new Error(resp.error || "读取净化规则配置失败");
      }
      return resp.data;
    },
  });

  // 2. 查询快照历史
  const historyQuery = useQuery({
    queryKey: ["nacos-cleaner-history", historyDrawerOpen],
    enabled: historyDrawerOpen,
    queryFn: async () => {
      const resp = await fetchNacosAdminConfigHistory({ dataId: CLEANER_DATA_ID, group: DEFAULT_GROUP, limit: 30 });
      if (!resp.success) throw new Error(resp.error || "获取历史快照失败");
      return resp.data;
    },
  });

  // 3. 发布配置 Mutation
  const publishMutation = useMutation({
    mutationFn: async (payload: { content: string; reason: string }) => {
      const resp = await publishNacosAdminConfig({
        dataId: CLEANER_DATA_ID,
        group: DEFAULT_GROUP,
        type: "json",
        content: payload.content,
        reason: payload.reason,
      });
      if (!resp.success) {
        throw new Error(resp.error || "发布配置到 Nacos 失败");
      }
      return resp.data;
    },
    onSuccess: () => {
      messageApi.success("🎉 净化规则已成功发布至 Nacos，客户端秒级热生效！");
      setIsPublishModalOpen(false);
      setPublishReason("");
      configQuery.refetch();
    },
    onError: (err: any) => {
      messageApi.error(`发布失败: ${err.message || err}`);
    },
  });

  // 接收接口数据并初始化
  useEffect(() => {
    if (configQuery.data?.content) {
      try {
        const parsed = JSON.parse(configQuery.data.content);
        if (parsed && typeof parsed === "object" && parsed.rules) {
          const mergedConfig: CleanerRemoteConfig = {
            ...DEFAULT_CLEANER_CONFIG,
            ...parsed,
            rules: {
              ...DEFAULT_CLEANER_CONFIG.rules,
              ...parsed.rules,
            },
          };
          setConfig(mergedConfig);
          setOriginalContent(JSON.stringify(mergedConfig, null, 2));
        }
      } catch (e) {
        console.warn("Failed to parse remote cleaner rules, using defaults", e);
      }
    }
  }, [configQuery.data]);

  // 计算是否有未发布修改
  const isDirty = useMemo(() => {
    // 若线上尚未初始化配置，则允许直接发布默认初始配置
    if (!configQuery.data?.content) return true;
    if (!originalContent) return false;
    return JSON.stringify(config, null, 2) !== originalContent;
  }, [config, originalContent, configQuery.data?.content]);

  // 统计概览
  const stats = useMemo(() => {
    let strongCount = 0;
    let regexCount = 0;
    let intentCount = 0;
    let weakCount = 0;
    const ruleGroups = Object.values(config.rules || {});

    ruleGroups.forEach((g) => {
      if (!g) return;
      strongCount += g.strongKeywords?.length || 0;
      regexCount += g.regexPatterns?.length || 0;
      intentCount += g.intentKeywords?.length || 0;
      weakCount += (g.exactKeywords?.length || 0) + (g.fuzzyKeywords?.length || 0);
    });

    return {
      groupCount: ruleGroups.length,
      strongCount,
      regexCount,
      intentCount,
      weakCount,
      exemptCount: config.globalExemptHandles?.length || 0,
    };
  }, [config]);

  // 标签删除处理
  const handleRemoveTag = (
    groupKey: string,
    field: "strongKeywords" | "intentKeywords" | "exactKeywords" | "fuzzyKeywords",
    tagToRemove: string
  ) => {
    setConfig((prev) => {
      const group = prev.rules[groupKey];
      if (!group) return prev;
      const currentList: string[] = (group as any)[field] || [];
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [groupKey]: {
            ...group,
            [field]: currentList.filter((item) => item !== tagToRemove),
          },
        },
      };
    });
  };

  // 全局加白 Handle 删除
  const handleRemoveExemptHandle = (handleToRemove: string) => {
    setConfig((prev) => ({
      ...prev,
      globalExemptHandles: (prev.globalExemptHandles || []).filter((h) => h !== handleToRemove),
    }));
  };

  // 批量添加确认
  const handleBatchSubmit = () => {
    const rawTokens = batchInputText
      .split(/[\r\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (rawTokens.length === 0) {
      messageApi.warning("请输入有效的内容");
      return;
    }

    if (batchTargetField === "globalExemptHandles") {
      const cleanedHandles = rawTokens.map((h) => h.replace(/^@/, "").toLowerCase());
      setConfig((prev) => ({
        ...prev,
        globalExemptHandles: Array.from(new Set([...(prev.globalExemptHandles || []), ...cleanedHandles])),
      }));
    } else {
      setConfig((prev) => {
        const group = prev.rules[activeTab];
        if (!group) return prev;
        const currentList: string[] = (group as any)[batchTargetField] || [];
        return {
          ...prev,
          rules: {
            ...prev.rules,
            [activeTab]: {
              ...group,
              [batchTargetField]: Array.from(new Set([...currentList, ...rawTokens])),
            },
          },
        };
      });
    }

    messageApi.success(`已成功添加 ${rawTokens.length} 个条目`);
    setBatchModalVisible(false);
    setBatchInputText("");
  };

  // 正则保存/编辑
  const handleSaveRegex = () => {
    const pattern = regexInput.trim();
    if (!pattern) {
      messageApi.warning("正则表达式不能为空");
      return;
    }

    // 校验正则合法性
    try {
      new RegExp(pattern, "i");
    } catch (err: any) {
      messageApi.error(`正则表达式语法错误: ${err.message}`);
      return;
    }

    // 基础 ReDoS 检查 (嵌套量词防护)
    if (/(\+|\*|\{.*\}).*(\+|\*|\{.*\})/.test(pattern) && /\(.*\)/.test(pattern)) {
      messageApi.warning("⚠️ 正则表达式中包含复杂嵌套量词，请注意防范回溯性能影响");
    }

    setConfig((prev) => {
      const group = prev.rules[activeTab];
      if (!group) return prev;
      const patterns = [...(group.regexPatterns || [])];
      if (regexEditIndex !== null && regexEditIndex >= 0) {
        patterns[regexEditIndex] = pattern;
      } else {
        if (!patterns.includes(pattern)) patterns.push(pattern);
      }
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [activeTab]: {
            ...group,
            regexPatterns: patterns,
          },
        },
      };
    });

    setRegexModalVisible(false);
    setRegexInput("");
    setRegexEditIndex(null);
  };

  // AI 生成正则建议
  const handleGenerateAiRegex = async () => {
    const text = aiSampleText.trim();
    if (!text) {
      messageApi.warning("请输入违规样本语句或引流话术");
      return;
    }

    setAiGenerating(true);
    try {
      const resp = await suggestCleanerRegexWithAi({
        text,
        groupKey: activeTab,
        groupName: currentGroup?.name,
        notes: aiNotes.trim(),
      });

      if (!resp.success || !resp.data) {
        throw new Error(resp.error || "生成建议正则失败");
      }

      const suggestions = resp.data.suggestions || [];
      setAiSuggestions(suggestions);
      setAiAnalysis(resp.data.analysis || "");

      // 默认全选尚未存在于规则组中的正则
      const existing = new Set(currentGroup?.regexPatterns || []);
      const defaultSelected = suggestions
        .map((s) => s.pattern)
        .filter((p) => !existing.has(p));
      setSelectedAiPatterns(defaultSelected);

      if (suggestions.length === 0) {
        messageApi.info("未生成到匹配的正则，请补充更多样本特征");
      } else {
        messageApi.success(`已成功分析并生成 ${suggestions.length} 条建议正则`);
      }
    } catch (err: any) {
      messageApi.error(`AI 生成建议失败: ${err.message || err}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // 批量保存选中的 AI 正则
  const handleSaveSelectedAiRegex = () => {
    if (selectedAiPatterns.length === 0) {
      messageApi.warning("请至少选择一个正则表达式保存");
      return;
    }

    const validPatterns: string[] = [];
    for (const pattern of selectedAiPatterns) {
      try {
        new RegExp(pattern, "i");
        validPatterns.push(pattern);
      } catch (e: any) {
        messageApi.error(`正则表达式语法错误: /${pattern}/i (${e.message})`);
        return;
      }
    }

    let addedCount = 0;
    setConfig((prev) => {
      const group = prev.rules[activeTab];
      if (!group) return prev;
      const patterns = [...(group.regexPatterns || [])];
      for (const pattern of validPatterns) {
        if (!patterns.includes(pattern)) {
          patterns.push(pattern);
          addedCount++;
        }
      }
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [activeTab]: {
            ...group,
            regexPatterns: patterns,
          },
        },
      };
    });

    messageApi.success(`已成功保存 ${addedCount} 个正则表达式至【${currentGroup?.name || activeTab}】（重复项已去重）`);
    setRegexModalVisible(false);
    setRegexInput("");
    setRegexEditIndex(null);
    setSelectedAiPatterns([]);
  };

  // 单独保存单条 AI 建议正则
  const handleAddSingleAiRegex = (pattern: string) => {
    try {
      new RegExp(pattern, "i");
    } catch (e: any) {
      messageApi.error(`正则表达式语法错误: ${e.message}`);
      return;
    }

    let isNew = false;
    setConfig((prev) => {
      const group = prev.rules[activeTab];
      if (!group) return prev;
      const patterns = [...(group.regexPatterns || [])];
      if (!patterns.includes(pattern)) {
        patterns.push(pattern);
        isNew = true;
      }
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [activeTab]: {
            ...group,
            regexPatterns: patterns,
          },
        },
      };
    });

    if (isNew) {
      messageApi.success(`已添加正则: /${pattern}/i`);
    } else {
      messageApi.info("该正则表达式已存在于规则库中");
    }
  };

  // 填入手工编辑框微调
  const handleUseInManual = (pattern: string) => {
    setRegexInput(pattern);
    setRegexModalTab("manual");
    messageApi.info("已将正则填入手工编辑模式，您可自由微调");
  };


  // 运行沙箱测试
  const runSandboxTest = () => {
    const author = sandboxAuthor.trim().replace(/^@/, "").toLowerCase();
    const text = sandboxTweetText.trim();
    if (!text) {
      messageApi.warning("请输入待测试推文正文");
      return;
    }

    const t0 = performance.now();

    // 1. 检查加白
    if (author && config.globalExemptHandles?.map((h) => h.toLowerCase()).includes(author)) {
      const costMs = Math.round((performance.now() - t0) * 100) / 100;
      setSandboxResult({
        tested: true,
        matched: false,
        ruleName: "全局白名单",
        reason: `博主 @${author} 命中全局加白名单，豁免放行`,
        costMs,
      });
      return;
    }

    const { normalized, stripped } = normalizeSandboxText(text);
    const lowerNormalized = normalized.toLowerCase();
    const textLength = stripped.length;

    // 遍历所有启用的规则组
    for (const [groupKey, group] of Object.entries(config.rules || {})) {
      if (!group || !group.enabled) continue;
      const category = groupKey === "adult_traffic" ? "色情引流" : groupKey === "gray_promotion" ? "灰产引流" : "自定义";

      // 强词检查
      if (Array.isArray(group.strongKeywords)) {
        for (const kw of group.strongKeywords) {
          const cleanKw = kw.trim().toLowerCase();
          const { stripped: cleanStripped } = normalizeSandboxText(kw);
          if (
            (cleanKw && lowerNormalized.includes(cleanKw)) ||
            (cleanStripped && stripped.includes(cleanStripped))
          ) {
            const costMs = Math.round((performance.now() - t0) * 100) / 100;
            setSandboxResult({
              tested: true,
              matched: true,
              category,
              ruleName: group.name,
              reason: `命中强引流特征词: "${kw}"`,
              matchedWord: kw,
              costMs,
            });
            return;
          }
        }
      }

      // 正则检查
      if (Array.isArray(group.regexPatterns)) {
        for (const pattern of group.regexPatterns) {
          try {
            const reg = new RegExp(pattern, "i");
            if (reg.test(normalized) || reg.test(text) || reg.test(stripped)) {
              const costMs = Math.round((performance.now() - t0) * 100) / 100;
              setSandboxResult({
                tested: true,
                matched: true,
                category,
                ruleName: group.name,
                reason: `命中模式匹配: /${pattern}/`,
                matchedWord: pattern,
                costMs,
              });
              return;
            }
          } catch {}
        }
      }

      // 弱词 + 意向词二次检查 (受长文保护)
      const maxWeak = group.maxWeakSpamLength ?? 80;
      if (textLength <= maxWeak) {
        const intentKeywords = group.intentKeywords || [];
        const hasIntent = intentKeywords.some((intent) => {
          const clean = intent.trim().toLowerCase();
          return clean && (lowerNormalized.includes(clean) || stripped.includes(clean));
        });

        if (hasIntent) {
          for (const word of group.exactKeywords || []) {
            const cleanWord = word.trim().toLowerCase();
            if (cleanWord && lowerNormalized.includes(cleanWord)) {
              const costMs = Math.round((performance.now() - t0) * 100) / 100;
              setSandboxResult({
                tested: true,
                matched: true,
                category,
                ruleName: group.name,
                reason: `短回复引流特征: 命中精准弱词 "${word}" 且包含引流意向动作`,
                matchedWord: word,
                costMs,
              });
              return;
            }
          }

          for (const word of group.fuzzyKeywords || []) {
            const { stripped: cleanStripped } = normalizeSandboxText(word);
            if (cleanStripped && stripped.includes(cleanStripped)) {
              const costMs = Math.round((performance.now() - t0) * 100) / 100;
              setSandboxResult({
                tested: true,
                matched: true,
                category,
                ruleName: group.name,
                reason: `短回复引流特征: 命中模糊弱词 "${word}" 且包含引流意向动作`,
                matchedWord: word,
                costMs,
              });
              return;
            }
          }
        }
      }
    }

    const costMs = Math.round((performance.now() - t0) * 100) / 100;
    setSandboxResult({
      tested: true,
      matched: false,
      reason: "未命中任何已启用的强词、正则模式或弱词引流组合，判定为正常推文",
      costMs,
    });
  };

  // 恢复快照确认
  const handleRestoreSnapshot = async (snapshot: NacosAdminConfigSnapshot) => {
    try {
      const resp = await fetchNacosAdminConfigSnapshot(snapshot.id);
      if (!resp.success || !resp.data?.content) {
        throw new Error(resp.error || "获取快照详情失败");
      }
      const parsed = JSON.parse(resp.data.content);
      if (parsed && parsed.rules) {
        setConfig(parsed);
        messageApi.success(`已恢复到快照版本: ${new Date(snapshot.createdAt).toLocaleString("zh-CN")}`);
        setHistoryDrawerOpen(false);
      } else {
        messageApi.error("快照内容不合法，无法恢复");
      }
    } catch (e: any) {
      messageApi.error(`恢复快照失败: ${e.message}`);
    }
  };

  const currentGroup = config.rules[activeTab];

  return (
    <PermissionGuard permission="cleaner-config">
      {contextHolder}
      <div style={{ padding: "20px" }}>
        {/* 页眉卡片 */}
        <Card style={{ marginBottom: 20 }}>
          <Row justify="space-between" align="middle" gutter={[16, 16]}>
            <Col xs={24} md={14}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space align="center">
                  <SafetyCertificateOutlined style={{ fontSize: 26, color: "#1677ff" }} />
                  <Title level={4} style={{ margin: 0 }}>
                    信息流净化规则管理 (X-Cleaner)
                  </Title>
                  <Tag color={config.enabled ? "green" : "red"}>
                    {config.enabled ? "全局启用中" : "已暂停全局过滤"}
                  </Tag>
                  {isDirty && <Tag color="gold">存在未发布修改</Tag>}
                </Space>
                <Text type="secondary">
                  控制 X (Twitter) 热门推文评论区黄推、灰产引流机器人的动态过滤与标注策略，配置由 Nacos 集中热下发，免发版生效。
                </Text>
              </Space>
            </Col>
            <Col xs={24} md={10} style={{ textAlign: "right" }}>
              <Space wrap>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => configQuery.refetch()}
                  loading={configQuery.isFetching}
                >
                  拉取线上
                </Button>
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryDrawerOpen(true)}
                >
                  历史快照
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  disabled={!isDirty}
                  onClick={() => setIsPublishModalOpen(true)}
                >
                  发布上线
                </Button>
              </Space>
            </Col>
          </Row>

          <Divider style={{ margin: "16px 0" }} />

          {/* 指标统计栏 */}
          <Row gutter={16}>
            <Col xs={12} sm={4}>
              <Statistic title="规则组数" value={stats.groupCount} suffix="组" />
            </Col>
            <Col xs={12} sm={4}>
              <Statistic title="强特征词 (无条件拦截)" value={stats.strongCount} suffix="条" valueStyle={{ color: "#cf1322" }} />
            </Col>
            <Col xs={12} sm={4}>
              <Statistic title="高级正则表达式" value={stats.regexCount} suffix="个" valueStyle={{ color: "#d4380d" }} />
            </Col>
            <Col xs={12} sm={4}>
              <Statistic title="引流意向词" value={stats.intentCount} suffix="个" valueStyle={{ color: "#d46b08" }} />
            </Col>
            <Col xs={12} sm={4}>
              <Statistic title="弱特征词库" value={stats.weakCount} suffix="条" valueStyle={{ color: "#389e0d" }} />
            </Col>
            <Col xs={12} sm={4}>
              <Statistic title="全局加白博主" value={stats.exemptCount} suffix="位" valueStyle={{ color: "#1677ff" }} />
            </Col>
          </Row>
        </Card>

        {/* 规则配置主体 */}
        <Card style={{ marginBottom: 20 }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "adult_traffic",
                label: `🔞 色情/擦边引流 (${config.rules.adult_traffic?.strongKeywords?.length || 0})`,
              },
              {
                key: "gray_promotion",
                label: `🎲 灰产博彩/暗语 (${config.rules.gray_promotion?.strongKeywords?.length || 0})`,
              },
              {
                key: "global_exempt",
                label: `🛡️ 全局白名单 (${config.globalExemptHandles?.length || 0})`,
              },
            ]}
          />

          {/* 全局加白名单 Tab */}
          {activeTab === "global_exempt" ? (
            <div>
              <Alert
                message="全局白名单博主说明"
                description="白名单内的博主及其推文将直接跳过任何信息流降噪与引流检测，100% 原样保留呈现（如官方账号、知名认证 KOL）。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              <div style={{ marginBottom: 16 }}>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setBatchTargetField("globalExemptHandles");
                    setBatchModalVisible(true);
                  }}
                >
                  批量添加加白博主 (@handle)
                </Button>
              </div>

              <Space size={[8, 12]} wrap>
                {(config.globalExemptHandles || []).map((handle) => (
                  <Tag
                    key={handle}
                    closable
                    color="blue"
                    onClose={() => handleRemoveExemptHandle(handle)}
                    style={{ fontSize: 13, padding: "4px 8px" }}
                  >
                    @{handle}
                  </Tag>
                ))}
              </Space>
            </div>
          ) : currentGroup ? (
            /* 规则组 Tab */
            <div>
              <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <Space align="center">
                    <Text strong>规则组启用状态：</Text>
                    <Switch
                      checked={currentGroup.enabled}
                      onChange={(checked) => {
                        setConfig((prev) => ({
                          ...prev,
                          rules: {
                            ...prev.rules,
                            [activeTab]: { ...(prev.rules[activeTab] || currentGroup), enabled: checked },
                          },
                        }));
                      }}
                    />
                    <Text strong style={{ marginLeft: 20 }}>长文保护阈值：</Text>
                    <InputNumber
                      min={20}
                      max={500}
                      value={currentGroup.maxWeakSpamLength ?? 80}
                      onChange={(val) => {
                        setConfig((prev) => ({
                          ...prev,
                          rules: {
                            ...prev.rules,
                            [activeTab]: { ...(prev.rules[activeTab] || currentGroup), maxWeakSpamLength: val || 80 },
                          },
                        }));
                      }}
                      addonAfter="字"
                    />
                    <Tooltip title="推文纯文本字符数若超过此长度，说明属于长篇观点或讨论，弱特征词将自动放行，避免误伤分析长文。">
                      <QuestionCircleOutlined style={{ color: "#8c8c8c" }} />
                    </Tooltip>
                  </Space>
                </Col>
              </Row>

              <Divider style={{ margin: "16px 0" }} />

              {/* 1. 强特征词 */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <Text strong style={{ fontSize: 15, color: "#cf1322" }}>
                      1. 强特征词 (Strong Keywords)
                    </Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      黑产专有暗语、引流典型诱导句式，无视字数全长直接命中拦截并标注/隐藏
                    </Text>
                  </div>
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setBatchTargetField("strongKeywords");
                      setBatchModalVisible(true);
                    }}
                  >
                    批量添加强特征词
                  </Button>
                </div>
                <Card size="small" style={{ background: "#fff1f0", borderColor: "#ffa39e" }}>
                  <Space size={[6, 10]} wrap>
                    {(currentGroup.strongKeywords || []).map((kw) => (
                      <Tag
                        key={kw}
                        closable
                        color="red"
                        onClose={() => handleRemoveTag(activeTab, "strongKeywords", kw)}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        {kw}
                      </Tag>
                    ))}
                    {(currentGroup.strongKeywords || []).length === 0 && (
                      <Text type="secondary">暂无强特征词</Text>
                    )}
                  </Space>
                </Card>
              </div>

              {/* 2. 高级正则表达式 */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <Text strong style={{ fontSize: 15, color: "#d4380d" }}>
                      2. 正则表达式模式 (Regex Patterns)
                    </Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      识别微信号引流、TG 群组链接、复杂同音变体
                    </Text>
                  </div>
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<ThunderboltOutlined />}
                      onClick={() => {
                        setRegexInput("");
                        setRegexEditIndex(null);
                        setRegexModalTab("ai");
                        setRegexModalVisible(true);
                      }}
                    >
                      AI 推荐正则
                    </Button>
                    <Button
                      size="small"
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setRegexInput("");
                        setRegexEditIndex(null);
                        setRegexModalTab("manual");
                        setRegexModalVisible(true);
                      }}
                    >
                      新增正则表达式
                    </Button>
                  </Space>
                </div>
                <Table
                  size="small"
                  pagination={false}
                  bordered
                  dataSource={(currentGroup.regexPatterns || []).map((pattern, idx) => ({
                    key: idx,
                    index: idx,
                    pattern,
                  }))}
                  columns={[
                    {
                      title: "序号",
                      dataIndex: "index",
                      width: 70,
                      render: (val) => val + 1,
                    },
                    {
                      title: "正则表达式 (模式自动忽略大小写 /i)",
                      dataIndex: "pattern",
                      render: (pattern: string) => {
                        let isValid = true;
                        try {
                          new RegExp(pattern, "i");
                        } catch {
                          isValid = false;
                        }
                        return (
                          <Space>
                            <code style={{ background: "#f5f5f5", padding: "2px 6px", borderRadius: 4 }}>
                              /{pattern}/i
                            </code>
                            {isValid ? (
                              <Tag color="green">语法合法</Tag>
                            ) : (
                              <Tag color="red">语法错误</Tag>
                            )}
                          </Space>
                        );
                      },
                    },
                    {
                      title: "操作",
                      width: 150,
                      render: (_: any, record: any) => (
                        <Space>
                          <Button
                            size="small"
                            type="link"
                            onClick={() => {
                              setRegexInput(record.pattern);
                              setRegexEditIndex(record.index);
                              setRegexModalVisible(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title="确定删除此正则表达式吗？"
                            onConfirm={() => {
                              setConfig((prev) => {
                                const group = prev.rules[activeTab];
                                if (!group) return prev;
                                const patterns = [...(group.regexPatterns || [])];
                                patterns.splice(record.index, 1);
                                return {
                                  ...prev,
                                  rules: {
                                    ...prev.rules,
                                    [activeTab]: { ...group, regexPatterns: patterns },
                                  },
                                };
                              });
                            }}
                          >
                            <Button size="small" type="link" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </div>

              {/* 3. 引流意向词 */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <Text strong style={{ fontSize: 15, color: "#d46b08" }}>
                      3. 引流意向词 (Intent Keywords)
                    </Text>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      引流动作特征词（如主页、置顶、私信、进群、加微），在短文本中与弱词组合做二次判定
                    </Text>
                  </div>
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setBatchTargetField("intentKeywords");
                      setBatchModalVisible(true);
                    }}
                  >
                    批量添加意向词
                  </Button>
                </div>
                <Card size="small" style={{ background: "#fffbe6", borderColor: "#ffe58f" }}>
                  <Space size={[6, 10]} wrap>
                    {(currentGroup.intentKeywords || []).map((kw) => (
                      <Tag
                        key={kw}
                        closable
                        color="orange"
                        onClose={() => handleRemoveTag(activeTab, "intentKeywords", kw)}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        {kw}
                      </Tag>
                    ))}
                  </Space>
                </Card>
              </div>

              {/* 4. 弱特征词 (精准与模糊) */}
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 14 }}>
                      精准弱词 (Exact Keywords, {currentGroup.exactKeywords?.length || 0})
                    </Text>
                    <Button
                      size="small"
                      type="dashed"
                      onClick={() => {
                        setBatchTargetField("exactKeywords");
                        setBatchModalVisible(true);
                      }}
                    >
                      + 批量添加
                    </Button>
                  </div>
                  <Card size="small" style={{ maxHeight: 220, overflowY: "auto" }}>
                    <Space size={[4, 8]} wrap>
                      {(currentGroup.exactKeywords || []).map((kw) => (
                        <Tag
                          key={kw}
                          closable
                          onClose={() => handleRemoveTag(activeTab, "exactKeywords", kw)}
                        >
                          {kw}
                        </Tag>
                      ))}
                    </Space>
                  </Card>
                </Col>
                <Col span={12}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 14 }}>
                      模糊弱词 (Fuzzy Keywords, {currentGroup.fuzzyKeywords?.length || 0})
                    </Text>
                    <Button
                      size="small"
                      type="dashed"
                      onClick={() => {
                        setBatchTargetField("fuzzyKeywords");
                        setBatchModalVisible(true);
                      }}
                    >
                      + 批量添加
                    </Button>
                  </div>
                  <Card size="small" style={{ maxHeight: 220, overflowY: "auto" }}>
                    <Space size={[4, 8]} wrap>
                      {(currentGroup.fuzzyKeywords || []).map((kw) => (
                        <Tag
                          key={kw}
                          closable
                          onClose={() => handleRemoveTag(activeTab, "fuzzyKeywords", kw)}
                        >
                          {kw}
                        </Tag>
                      ))}
                    </Space>
                  </Card>
                </Col>
              </Row>
            </div>
          ) : (
            <Empty description="未找到对应规则组" />
          )}
        </Card>

        {/* 🧪 推文清洗沙箱模拟测试器 (Rule Testing Sandbox) */}
        <Card
          title={
            <Space>
              <PlayCircleOutlined style={{ color: "#52c41a" }} />
              <span>推文清洗沙箱模拟测试器 (Rule Testing Sandbox)</span>
            </Space>
          }
          style={{ marginBottom: 20 }}
        >
          <Row gutter={16}>
            <Col xs={24} md={14}>
              <Form layout="vertical">
                <Form.Item label="推文作者 (@handle，可选用于白名单豁免测试)">
                  <Input
                    placeholder="例如: test_bot 或 elonmusk"
                    value={sandboxAuthor}
                    onChange={(e) => setSandboxAuthor(e.target.value)}
                  />
                </Form.Item>
                <Form.Item label="待测推文正文 (支持粘贴包含同音字、零宽字符、符号干扰的原始推文)">
                  <TextArea
                    rows={4}
                    placeholder="输入待测试的推文文本，点击右侧运行模拟..."
                    value={sandboxTweetText}
                    onChange={(e) => setSandboxTweetText(e.target.value)}
                  />
                </Form.Item>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={runSandboxTest}
                  style={{ background: "#52c41a", borderColor: "#52c41a" }}
                >
                  运行沙箱模拟检测
                </Button>
              </Form>
            </Col>
            <Col xs={24} md={10}>
              <Card
                title="模拟检测结果"
                size="small"
                style={{
                  height: "100%",
                  background: sandboxResult.tested
                    ? sandboxResult.matched
                      ? "#fff1f0"
                      : "#f6ffed"
                    : "#fafafa",
                  borderColor: sandboxResult.tested
                    ? sandboxResult.matched
                      ? "#ffa39e"
                      : "#b7eb8f"
                    : "#d9d9d9",
                }}
              >
                {!sandboxResult.tested ? (
                  <Empty description="输入文本并点击运行测试" style={{ marginTop: 30 }} />
                ) : (
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      {sandboxResult.matched ? (
                        <Tag color="error" style={{ fontSize: 14, padding: "4px 8px" }}>
                          🚨 触发拦截 (Mark / Hide)
                        </Tag>
                      ) : (
                        <Tag color="success" style={{ fontSize: 14, padding: "4px 8px" }}>
                          ✅ 正常放行
                        </Tag>
                      )}
                      <Tag color="default" style={{ float: "right" }}>
                        耗时: {sandboxResult.costMs} ms
                      </Tag>
                    </div>

                    <Descriptions size="small" column={1} bordered>
                      {sandboxResult.category && (
                        <Descriptions.Item label="判定类别">
                          <Text strong>{sandboxResult.category}</Text>
                        </Descriptions.Item>
                      )}
                      {sandboxResult.ruleName && (
                        <Descriptions.Item label="命中规则组">
                          {sandboxResult.ruleName}
                        </Descriptions.Item>
                      )}
                      {sandboxResult.matchedWord && (
                        <Descriptions.Item label="命中特征条目">
                          <code>{sandboxResult.matchedWord}</code>
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="判定原因分析">
                        {sandboxResult.reason}
                      </Descriptions.Item>
                    </Descriptions>
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        </Card>

        {/* 批量添加词条 Modal */}
        <Modal
          title={`批量添加词条 (${batchTargetField})`}
          open={batchModalVisible}
          onOk={handleBatchSubmit}
          onCancel={() => setBatchModalVisible(false)}
          okText="确认添加"
          cancelText="取消"
        >
          <Paragraph type="secondary">
            支持直接粘贴由换行符、逗号或空格分隔的多行词汇，系统将自动进行分词与去重处理。
          </Paragraph>
          <TextArea
            rows={8}
            placeholder="粘贴词条列表，如：&#10;看置顶推文&#10;私聊看主页&#10;同城约v"
            value={batchInputText}
            onChange={(e) => setBatchInputText(e.target.value)}
          />
        </Modal>

        {/* 正则新增/编辑 Modal */}
        <Modal
          title={
            regexEditIndex !== null ? (
              "编辑正则表达式"
            ) : (
              <Space>
                <ThunderboltOutlined style={{ color: "#1677ff" }} />
                <span>新增正则表达式</span>
                <Tag color="blue">{currentGroup?.name || activeTab}</Tag>
              </Space>
            )
          }
          open={regexModalVisible}
          width={regexEditIndex !== null ? 600 : 780}
          onCancel={() => {
            setRegexModalVisible(false);
            setRegexInput("");
            setRegexEditIndex(null);
            setSelectedAiPatterns([]);
          }}
          footer={
            regexEditIndex !== null ? (
              <Space>
                <Button
                  onClick={() => {
                    setRegexModalVisible(false);
                    setRegexInput("");
                    setRegexEditIndex(null);
                  }}
                >
                  取消
                </Button>
                <Button type="primary" onClick={handleSaveRegex}>
                  保存修改
                </Button>
              </Space>
            ) : regexModalTab === "ai" ? (
              <Space>
                <Button
                  onClick={() => {
                    setRegexModalVisible(false);
                    setRegexInput("");
                    setRegexEditIndex(null);
                    setSelectedAiPatterns([]);
                  }}
                >
                  取消
                </Button>
                {aiSuggestions.length > 0 ? (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    disabled={selectedAiPatterns.length === 0}
                    onClick={handleSaveSelectedAiRegex}
                  >
                    保存选中的正则 ({selectedAiPatterns.length})
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={aiGenerating}
                    disabled={!aiSampleText.trim()}
                    onClick={handleGenerateAiRegex}
                  >
                    AI 生成正则建议
                  </Button>
                )}
              </Space>
            ) : (
              <Space>
                <Button
                  onClick={() => {
                    setRegexModalVisible(false);
                    setRegexInput("");
                    setRegexEditIndex(null);
                  }}
                >
                  取消
                </Button>
                <Button type="primary" onClick={handleSaveRegex}>
                  保存正则
                </Button>
              </Space>
            )
          }
        >
          {regexEditIndex !== null ? (
            /* 编辑单条正则模式 */
            <Form layout="vertical">
              <Form.Item
                label="正则表达式字符串 (系统自动应用 /i 忽略大小写标志)"
                extra="请勿包含首尾的反斜杠 /，直接填写模式字符串，如：(?:加|微)[：:\s]*[a-zA-Z0-9_-]{5,20}"
              >
                <Input
                  placeholder="例如: (?:加|微)[：:\s]*[a-zA-Z0-9_-]{5,20}"
                  value={regexInput}
                  onChange={(e) => setRegexInput(e.target.value)}
                />
              </Form.Item>
            </Form>
          ) : (
            /* 新增正则：支持 AI 推荐生成与手工录入 */
            <div>
              <Tabs
                activeKey={regexModalTab}
                onChange={(k) => setRegexModalTab(k as "ai" | "manual")}
                items={[
                  {
                    key: "ai",
                    label: (
                      <span>
                        <ThunderboltOutlined style={{ color: "#faad14" }} />
                        AI 智能生成建议 (推荐)
                      </span>
                    ),
                    children: (
                      <div>
                        <Alert
                          message="AI 辅助生成说明"
                          description="直接粘贴推文违规引流、暗语或黄推话术样本，AI 将深度提炼引流句式、同音变体与联系方式特征，生成多条候选正则表达式供您勾选保存。"
                          type="info"
                          showIcon
                          style={{ marginBottom: 14 }}
                        />

                        <div style={{ marginBottom: 10 }}>
                          <Space wrap size={[6, 8]}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              快捷话术样本：
                            </Text>
                            {AI_SAMPLE_PRESETS.map((preset, idx) => (
                              <Tag
                                key={idx}
                                color="blue"
                                style={{ cursor: "pointer", userSelect: "none" }}
                                onClick={() => setAiSampleText(preset.text)}
                              >
                                {preset.label}
                              </Tag>
                            ))}
                          </Space>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          <Text strong style={{ display: "block", marginBottom: 6 }}>
                            违规推文样本语句 / 引流话术：
                          </Text>
                          <TextArea
                            rows={3}
                            placeholder="在此粘贴你想拦截的推文垃圾评论、引流暗号或整句样本，例如：私信我看完整版无码合集福利，加微: abc_8888"
                            value={aiSampleText}
                            onChange={(e) => setAiSampleText(e.target.value)}
                            maxLength={2000}
                            showCount
                          />
                        </div>

                        <Row gutter={12} align="middle" style={{ marginBottom: 16 }}>
                          <Col flex="auto">
                            <Input
                              placeholder="选填补充要求，例如：重点匹配微信号变体、严格防误伤长文、针对TG群组等"
                              value={aiNotes}
                              onChange={(e) => setAiNotes(e.target.value)}
                            />
                          </Col>
                          <Col>
                            <Button
                              type="primary"
                              icon={<ThunderboltOutlined />}
                              loading={aiGenerating}
                              disabled={!aiSampleText.trim()}
                              onClick={handleGenerateAiRegex}
                            >
                              AI 分析并生成
                            </Button>
                          </Col>
                        </Row>

                        {/* AI 建议列表展示 */}
                        {aiSuggestions.length > 0 && (
                          <div style={{ marginTop: 16 }}>
                            <Divider style={{ margin: "14px 0" }} />

                            {aiAnalysis && (
                              <Alert
                                message={
                                  <Space>
                                    <BulbOutlined style={{ color: "#faad14" }} />
                                    <span>
                                      <strong>特征分析：</strong>
                                      {aiAnalysis}
                                    </span>
                                  </Space>
                                }
                                type="success"
                                style={{ marginBottom: 14 }}
                              />
                            )}

                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 10,
                              }}
                            >
                              <Space>
                                <Checkbox
                                  indeterminate={
                                    selectedAiPatterns.length > 0 &&
                                    selectedAiPatterns.length < aiSuggestions.length
                                  }
                                  checked={
                                    aiSuggestions.length > 0 &&
                                    selectedAiPatterns.length === aiSuggestions.length
                                  }
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedAiPatterns(aiSuggestions.map((s) => s.pattern));
                                    } else {
                                      setSelectedAiPatterns([]);
                                    }
                                  }}
                                >
                                  <strong>全选候选正则</strong>
                                </Checkbox>
                                <Text type="secondary" style={{ fontSize: 13 }}>
                                  (已选 {selectedAiPatterns.length} / {aiSuggestions.length} 项)
                                </Text>
                              </Space>

                              <Space>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    const existing = new Set(currentGroup?.regexPatterns || []);
                                    setSelectedAiPatterns(
                                      aiSuggestions.map((s) => s.pattern).filter((p) => !existing.has(p))
                                    );
                                  }}
                                >
                                  仅选未入库项
                                </Button>
                              </Space>
                            </div>

                            <Space direction="vertical" style={{ width: "100%" }} size={12}>
                              {aiSuggestions.map((sug, idx) => {
                                const isSelected = selectedAiPatterns.includes(sug.pattern);
                                const isAlreadyInGroup = (currentGroup?.regexPatterns || []).includes(sug.pattern);

                                let matchedText = "";
                                try {
                                  const m = aiSampleText.match(new RegExp(sug.pattern, "i"));
                                  if (m) matchedText = m[0];
                                } catch (_) {}

                                return (
                                  <Card
                                    key={idx}
                                    size="small"
                                    style={{
                                      borderColor: isSelected ? "#1677ff" : "#d9d9d9",
                                      backgroundColor: isSelected ? "#f0f7ff" : "#ffffff",
                                      transition: "all 0.2s",
                                    }}
                                  >
                                    <Row justify="space-between" align="top" gutter={[12, 8]}>
                                      <Col flex="auto">
                                        <Space align="center" wrap style={{ marginBottom: 6 }}>
                                          <Checkbox
                                            checked={isSelected}
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              setSelectedAiPatterns((prev) =>
                                                checked
                                                  ? [...prev, sug.pattern]
                                                  : prev.filter((p) => p !== sug.pattern)
                                              );
                                            }}
                                          >
                                            <Text strong style={{ fontSize: 14 }}>
                                              {sug.title}
                                            </Text>
                                          </Checkbox>
                                          {sug.recommended && <Tag color="gold">⭐ 重点推荐</Tag>}
                                          {sug.strictness === "precise" && <Tag color="blue">高精度</Tag>}
                                          {sug.strictness === "balanced" && <Tag color="green">均衡模式</Tag>}
                                          {sug.strictness === "broad" && <Tag color="orange">广谱拦截</Tag>}
                                          {isAlreadyInGroup && <Tag color="default">已在规则库</Tag>}
                                        </Space>

                                        <div style={{ marginBottom: 8 }}>
                                          <Space wrap>
                                            <code
                                              style={{
                                                background: isSelected ? "#e6f4ff" : "#f5f5f5",
                                                padding: "3px 8px",
                                                borderRadius: 4,
                                                fontFamily: "monospace",
                                                fontSize: 13,
                                                color: "#cf1322",
                                                wordBreak: "break-all",
                                              }}
                                            >
                                              /{sug.pattern}/i
                                            </code>
                                            <Tooltip title="复制正则表达式">
                                              <Button
                                                size="small"
                                                type="text"
                                                icon={<CopyOutlined />}
                                                onClick={() => {
                                                  navigator.clipboard?.writeText(sug.pattern);
                                                  messageApi.success("已复制到剪贴板");
                                                }}
                                              />
                                            </Tooltip>
                                            {matchedText ? (
                                              <Tag color="cyan">已命中样本片段: "{matchedText}"</Tag>
                                            ) : (
                                              <Tag color="default">未直接命中当前样本 (泛化规则)</Tag>
                                            )}
                                          </Space>
                                        </div>

                                        <Paragraph
                                          type="secondary"
                                          style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}
                                        >
                                          {sug.description}
                                        </Paragraph>
                                      </Col>

                                      <Col>
                                        <Space direction="vertical" align="end" size={4}>
                                          <Button
                                            size="small"
                                            type="link"
                                            onClick={() => handleUseInManual(sug.pattern)}
                                          >
                                            填入手工编辑
                                          </Button>
                                          {!isAlreadyInGroup && (
                                            <Button
                                              size="small"
                                              type="link"
                                              onClick={() => handleAddSingleAiRegex(sug.pattern)}
                                            >
                                              单独添加
                                            </Button>
                                          )}
                                        </Space>
                                      </Col>
                                    </Row>
                                  </Card>
                                );
                              })}
                            </Space>
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: "manual",
                    label: <span>✍️ 手工输入模式</span>,
                    children: (
                      <Form layout="vertical" style={{ marginTop: 8 }}>
                        <Form.Item
                          label="正则表达式模式字符串 (系统自动应用 /i 忽略大小写标志)"
                          extra="请勿包含首尾的反斜杠 /，直接填写模式字符串，如：(?:加|微)[：:\s]*[a-zA-Z0-9_-]{5,20}"
                        >
                          <Input
                            placeholder="例如: (?:加|微)[：:\s]*[a-zA-Z0-9_-]{5,20}"
                            value={regexInput}
                            onChange={(e) => setRegexInput(e.target.value)}
                          />
                        </Form.Item>
                        {regexInput.trim() && (
                          <div style={{ marginTop: 8 }}>
                            <Text type="secondary">语法预览：</Text>
                            {(() => {
                              try {
                                new RegExp(regexInput.trim(), "i");
                                return <Tag color="green">语法合法 /{regexInput.trim()}/i</Tag>;
                              } catch (err: any) {
                                return <Tag color="red">语法错误: {err.message}</Tag>;
                              }
                            })()}
                          </div>
                        )}
                      </Form>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </Modal>

        {/* 发布上线确认 Modal */}
        <Modal
          title="发布规则至 Nacos"
          open={isPublishModalOpen}
          onOk={() => {
            if (!publishReason.trim()) {
              messageApi.warning("请输入本次发布的变更说明");
              return;
            }
            const nextVersion = Number(dayjs().format("YYYYMMDDHHmmss"));
            const updatedConfig: CleanerRemoteConfig = {
              ...config,
              version: nextVersion,
              updateTime: new Date().toISOString(),
            };
            publishMutation.mutate({
              content: JSON.stringify(updatedConfig, null, 2),
              reason: publishReason.trim(),
            });
          }}
          confirmLoading={publishMutation.isPending}
          okText="确认发布生效"
          cancelText="取消"
        >
          <Alert
            message="发布前安全须知"
            description="发布后最新规则将立即推送到 Nacos 配置中心，并在 30 分钟缓存窗口内由全量 XHunt 插件客户端拉取热生效。"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form layout="vertical">
            <Form.Item label="变更原因 / 发布备注 (必填，计入快照审计日志)" required>
              <TextArea
                rows={3}
                placeholder="例如: 新增某批同音黄推暗语及TG引流特征过滤"
                value={publishReason}
                onChange={(e) => setPublishReason(e.target.value)}
              />
            </Form.Item>
          </Form>
        </Modal>

        {/* 历史快照 Drawer */}
        <Drawer
          title="Nacos 配置快照与回滚历史"
          width={640}
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
        >
          {historyQuery.isLoading ? (
            <div style={{ textAlign: "center", padding: "40px" }}>加载历史中...</div>
          ) : (
            <Table
              size="small"
              dataSource={historyQuery.data || []}
              rowKey="id"
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: "发布时间",
                  dataIndex: "createdAt",
                  width: 170,
                  render: (val) => new Date(val).toLocaleString("zh-CN", { hour12: false }),
                },
                {
                  title: "操作人",
                  dataIndex: "operatorEmail",
                  width: 140,
                },
                {
                  title: "变更备注",
                  dataIndex: "reason",
                  render: (val) => val || "-",
                },
                {
                  title: "操作",
                  width: 100,
                  render: (_: any, record: NacosAdminConfigSnapshot) => (
                    <Popconfirm
                      title="确定要将当前编辑状态回滚至此快照版本吗？"
                      onConfirm={() => handleRestoreSnapshot(record)}
                    >
                      <Button size="small" type="link">
                        恢复此版本
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]}
            />
          )}
        </Drawer>
      </div>
    </PermissionGuard>
  );
}
