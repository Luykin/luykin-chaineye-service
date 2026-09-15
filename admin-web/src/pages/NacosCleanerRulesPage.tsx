import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchNacosAdminConfig,
  fetchNacosAdminConfigHistory,
  fetchNacosAdminConfigSnapshot,
  publishNacosAdminConfig,
} from "@/services/nacos";
import type {
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

export function NacosCleanerRulesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<string>("adult_traffic");
  const [config, setConfig] = useState<CleanerRemoteConfig>(DEFAULT_CLEANER_CONFIG);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishReason, setPublishReason] = useState("");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<NacosAdminConfigSnapshot | null>(null);

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
          setConfig({
            ...DEFAULT_CLEANER_CONFIG,
            ...parsed,
            rules: {
              ...DEFAULT_CLEANER_CONFIG.rules,
              ...parsed.rules,
            },
          });
          setOriginalContent(JSON.stringify(parsed, null, 2));
        }
      } catch (e) {
        console.warn("Failed to parse remote cleaner rules, using defaults", e);
      }
    }
  }, [configQuery.data]);

  // 计算是否有未发布修改
  const isDirty = useMemo(() => {
    if (!originalContent) return false;
    return JSON.stringify(config, null, 2) !== originalContent;
  }, [config, originalContent]);

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
      .split(/[\n,，\s]+/)
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
  const handleRestoreSnapshot = (snapshot: NacosAdminConfigSnapshot) => {
    try {
      const parsed = JSON.parse(snapshot.content || "{}");
      if (parsed && parsed.rules) {
        setConfig(parsed);
        messageApi.success(`已恢复到快照版本: ${snapshot.createdAt}`);
        setHistoryDrawerOpen(false);
      } else {
        messageApi.error("快照内容不合法，无法恢复");
      }
    } catch (e: any) {
      messageApi.error(`快照解析错误: ${e.message}`);
    }
  };

  const currentGroup = config.rules[activeTab];

  return (
    <PermissionGuard permission={["cleaner-config", "nacos_config"]}>
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
                            [activeTab]: { ...currentGroup, enabled: checked },
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
                            [activeTab]: { ...currentGroup, maxWeakSpamLength: val || 80 },
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
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setRegexInput("");
                      setRegexEditIndex(null);
                      setRegexModalVisible(true);
                    }}
                  >
                    新增正则表达式
                  </Button>
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
          title={regexEditIndex !== null ? "编辑正则表达式" : "新增正则表达式"}
          open={regexModalVisible}
          onOk={handleSaveRegex}
          onCancel={() => {
            setRegexModalVisible(false);
            setRegexInput("");
            setRegexEditIndex(null);
          }}
          okText="保存正则"
          cancelText="取消"
        >
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
            const updatedConfig: CleanerRemoteConfig = {
              ...config,
              version: Number(Date.now().toString().slice(0, 10)),
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
