import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Modal,
  Row,
  Col,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchFeatureFlagsConfig,
  fetchFeatureTranslations,
  fetchVipLists,
  publishFeatureFlagsConfig,
} from "@/services/feature-flags";
import type { FeatureFlagsConfig } from "@/types/feature-flags";

const DEFAULT_FEATURE_KEYS: Record<string, string> = {
  showAnalytics: "显示悬浮面板",
  showSidebarIcon: "显示侧边栏图标",
  showDeletedTweets: "显示已删除的推文",
  showAvatarRank: "显示头像排名",
  showTokenAnalysis: "显示代币分析",
  showProjectMembers: "显示关联人物",
  showInvestors: "显示获投资",
  showPortfolio: "显示已投资",
  show90dMention: "显示90天代币提及",
  show90dPerformance: "显示90天收益率",
  showPersonalityType: "显示性格类型",
  showRenameInfo: "显示改名",
  showDelInfo: "显示删帖",
  showDiscussion: "显示讨论功能",
  showKolAbilityModel: "显示KOL能力模型",
  showSoulIndex: "显示灵魂浓度",
  showNarrative: "显示叙事功能",
  showArticleBottomRightArea: "显示 XHunt 推广",
  showKolFollowers: "显示全球KOL粉丝",
  showTop100Kols: "显示TOP100 KOLs",
  showCnKols: "显示中文 KOLs",
  showFqRank: "显示全球影响力排名",
  showCnRank: "显示华语影响力排名",
  showEnInfluenceRank: "显示英文影响力排名",
  showProjectRank: "显示项目影响力排名",
  showReviews: "显示评论功能",
  showNotes: "显示备注",
  showOfficialTags: "显示官方标签",
  showRealtimeSubscription: "显示实时订阅",
  showEngageToEarn: "显示互动榜",
  showHunterCampaign: "显示贡献榜",
  showAnnualReport: "显示年度报告",
  enableBnbFeeds: "启用币安动态",
  enableGossip: "启用币圈热帖",
  enableListing: "启用上新/下架",
  showTweetAIAnalysis: "显示推文AI分析",
};

function parseConfig(content?: string): FeatureFlagsConfig {
  if (!content) return {};
  const parsed = JSON.parse(content) as FeatureFlagsConfig;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function cloneConfig(config: FeatureFlagsConfig): FeatureFlagsConfig {
  return JSON.parse(JSON.stringify(config)) as FeatureFlagsConfig;
}

function normalizeTags(values?: string[]) {
  return Array.from(new Set((values || []).map((item) => item.trim()).filter(Boolean)));
}

function formatFeatureLabel(key: string, translations: Record<string, string>) {
  const label = translations[key] || translations[key.replace(/^_/, "")];
  return label ? `${key} (${label})` : key;
}

function SummaryList({
  items,
  emptyText,
  translations,
  showCount,
}: {
  items: Array<{ key: string; count?: number }>;
  emptyText: string;
  translations: Record<string, string>;
  showCount?: boolean;
}) {
  if (!items.length) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }

  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Typography.Text ellipsis style={{ color: "#374151", fontSize: 13 }}>
            {formatFeatureLabel(item.key, translations)}
          </Typography.Text>
          {showCount ? <Tag color="blue">{item.count || 0} user(s)</Tag> : null}
        </div>
      ))}
    </Space>
  );
}

function TagEditor({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}) {
  return (
    <Select
      mode="tags"
      value={value}
      onChange={(next) => onChange(normalizeTags(next))}
      placeholder={placeholder || "输入后回车添加，支持粘贴逗号分隔内容"}
      tokenSeparators={[",", " ", "\n"]}
      maxTagCount="responsive"
      options={options}
      style={{ width: "100%" }}
    />
  );
}

function buildDiffHtml(oldConfig: FeatureFlagsConfig, newConfig: FeatureFlagsConfig) {
  if (window.Diff?.diffJson) {
    return window.Diff.diffJson(oldConfig, newConfig)
      .map((part) => {
        const className = part.added ? "ff-diff-added" : part.removed ? "ff-diff-removed" : "";
        const escaped = part.value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return className ? `<span class="${className}">${escaped}</span>` : escaped;
      })
      .join("");
  }

  return JSON.stringify(newConfig, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function FeatureFlagsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [config, setConfig] = useState<FeatureFlagsConfig>({});
  const [dirty, setDirty] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffHtml, setDiffHtml] = useState("");

  const translationsQuery = useQuery({
    queryKey: ["feature-flags", "translations"],
    queryFn: fetchFeatureTranslations,
    retry: false,
  });

  const translations = useMemo(
    () => ({
      ...DEFAULT_FEATURE_KEYS,
      ...(translationsQuery.data?.zh || {}),
    }),
    [translationsQuery.data]
  );

  const configQuery = useQuery({
    queryKey: ["feature-flags", "config"],
    queryFn: fetchFeatureFlagsConfig,
    select: (data) => parseConfig(data.data.content),
  });

  const vipListsQuery = useQuery({
    queryKey: ["feature-flags", "vip-lists"],
    queryFn: fetchVipLists,
  });

  useEffect(() => {
    if (!configQuery.data || dirty) return;
    setConfig(cloneConfig(configQuery.data));
  }, [configQuery.data, dirty]);

  const publishMutation = useMutation({
    mutationFn: (nextConfig: FeatureFlagsConfig) =>
      publishFeatureFlagsConfig(JSON.stringify(nextConfig, null, 2)),
    onSuccess: async () => {
      messageApi.success("发布成功");
      setDirty(false);
      setDiffOpen(false);
      await configQuery.refetch();
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "发布失败");
    },
  });

  const featureOptions = useMemo(
    () =>
      Object.entries(translations)
        .filter(([key]) => key.includes("show") || key.startsWith("enable"))
        .map(([key, label]) => ({ value: key, label: `${key} (${label})` })),
    [translations]
  );

  const vipUsers = useMemo(
    () => (vipListsQuery.data?.data.vip || []).map((item) => item.username),
    [vipListsQuery.data]
  );

  const internalUsers = useMemo(
    () => (vipListsQuery.data?.data.internalTest || []).map((item) => item.username),
    [vipListsQuery.data]
  );

  const flexibleTesting = (config.flexibleTesting || {}) as Record<string, string[]>;
  const testConfig = config.testConfig || { features: [], testers: [] };
  const canaryConfig = config.canaryConfig || { features: [], canaries: [] };

  function updateConfig(updater: (draft: FeatureFlagsConfig) => void) {
    const next = cloneConfig(config);
    updater(next);
    setConfig(next);
    setDirty(true);
  }

  function addUsersTo(target: "test" | "canary" | "flexible", list: string[], featureKey?: string) {
    updateConfig((draft) => {
      if (target === "test") {
        draft.testConfig = draft.testConfig || { features: [], testers: [] };
        draft.testConfig.testers = normalizeTags([...(draft.testConfig.testers || []), ...list]);
      }
      if (target === "canary") {
        draft.canaryConfig = draft.canaryConfig || { features: [], canaries: [] };
        draft.canaryConfig.canaries = normalizeTags([...(draft.canaryConfig.canaries || []), ...list]);
      }
      if (target === "flexible" && featureKey) {
        draft.flexibleTesting = draft.flexibleTesting || {};
        draft.flexibleTesting[featureKey] = normalizeTags([
          ...(draft.flexibleTesting[featureKey] || []),
          ...list,
        ]);
      }
    });
  }

  async function reloadConfig() {
    if (dirty) {
      const confirmed = window.confirm("当前有未发布改动，确定重新加载并丢弃这些改动吗？");
      if (!confirmed) return;
    }
    const result = await configQuery.refetch();
    if (result.data) {
      setConfig(cloneConfig(result.data));
      setDirty(false);
      messageApi.success("配置已刷新");
    }
  }

  async function openPublishConfirm() {
    if (!dirty) {
      messageApi.info("没有需要发布的改动");
      return;
    }

    try {
      const latest = parseConfig((await fetchFeatureFlagsConfig()).data.content);
      const oldStr = JSON.stringify(latest, null, 2);
      const newStr = JSON.stringify(config, null, 2);
      if (oldStr === newStr) {
        messageApi.info("与线上配置一致，没有变更");
        return;
      }
      setDiffHtml(buildDiffHtml(latest, config));
      setDiffOpen(true);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "获取最新配置失败");
    }
  }

  const summaryFlexible = Object.entries(flexibleTesting)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, users]) => ({ key, count: users.length }));
  const summaryTest = normalizeTags(testConfig.features).filter((key) => !key.startsWith("_")).map((key) => ({ key }));
  const summaryCanary = normalizeTags(canaryConfig.features).filter((key) => !key.startsWith("_")).map((key) => ({ key }));

  return (
    <PermissionGuard permission="feature_flags_config">
      {contextHolder}
      <PageSection
        title="功能开关"
        description="管理测试功能对特定用户的可见性。"
        extra={
          <Space>
            {dirty ? <Tag color="orange">未发布</Tag> : <Tag color="green">已同步</Tag>}
            <Button icon={<ReloadOutlined />} onClick={() => void reloadConfig()} loading={configQuery.isFetching}>
              刷新
            </Button>
            <Button type="primary" icon={<RocketOutlined />} onClick={() => void openPublishConfirm()}>
              发布
            </Button>
          </Space>
        }
      >
        {translationsQuery.isError ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="功能键翻译加载失败"
            description="当前仍可编辑配置，只是部分功能键不会显示中文说明。"
          />
        ) : null}

        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} lg={8}>
            <Card size="small" title="灵活测试">
              <SummaryList items={summaryFlexible} emptyText="No active flexible rules." translations={translations} showCount />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card size="small" title="测试组">
              <SummaryList items={summaryTest} emptyText="No features in test group." translations={translations} />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card size="small" title="金丝雀">
              <SummaryList items={summaryCanary} emptyText="No features in canary group." translations={translations} />
            </Card>
          </Col>
        </Row>

        <Tabs
          items={[
            {
              key: "flexible",
              label: "灵活测试",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">最高优先级，覆盖其他组的同名配置。</Typography.Text>
                  <Row gutter={[12, 12]}>
                    {Object.entries(flexibleTesting).map(([featureKey, users]) => (
                      <Col xs={24} xl={12} key={featureKey}>
                        <Card
                          size="small"
                          title={
                            <Input
                              defaultValue={featureKey}
                              onBlur={(event) => {
                                const nextKey = event.target.value.trim();
                                updateConfig((draft) => {
                                  draft.flexibleTesting = draft.flexibleTesting || {};
                                  if (!nextKey || nextKey === featureKey) return;
                                  draft.flexibleTesting[nextKey] = draft.flexibleTesting[featureKey] || [];
                                  delete draft.flexibleTesting[featureKey];
                                });
                              }}
                              onPressEnter={(event) => {
                                event.currentTarget.blur();
                              }}
                            />
                          }
                          extra={
                            <Button
                              danger
                              type="text"
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                updateConfig((draft) => {
                                  if (draft.flexibleTesting) delete draft.flexibleTesting[featureKey];
                                });
                              }}
                            />
                          }
                        >
                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {translations[featureKey] || translations[featureKey.replace(/^_/, "")] || "未匹配到中文说明"}
                            </Typography.Text>
                            <TagEditor
                              value={users}
                              onChange={(nextUsers) => {
                                updateConfig((draft) => {
                                  draft.flexibleTesting = draft.flexibleTesting || {};
                                  draft.flexibleTesting[featureKey] = nextUsers;
                                });
                              }}
                              placeholder="User handles"
                            />
                            <Space wrap>
                              <Button size="small" onClick={() => addUsersTo("flexible", vipUsers, featureKey)}>
                                + VIP 名单
                              </Button>
                              <Button size="small" onClick={() => addUsersTo("flexible", internalUsers, featureKey)}>
                                + 内测名单
                              </Button>
                            </Space>
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Button
                    icon={<PlusOutlined />}
                    block
                    onClick={() => {
                      updateConfig((draft) => {
                        draft.flexibleTesting = draft.flexibleTesting || {};
                        draft.flexibleTesting[`newFeature_${Date.now()}`] = [];
                      });
                    }}
                  >
                    添加规则
                  </Button>
                </Space>
              ),
            },
            {
              key: "test",
              label: "测试组",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">仅 Testers 列表中的用户可见。</Typography.Text>
                  <Card size="small">
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <div>
                        <Typography.Text strong>功能列表</Typography.Text>
                        <div style={{ marginTop: 8 }}>
                          <TagEditor
                            value={normalizeTags(testConfig.features)}
                            options={featureOptions}
                            onChange={(features) => {
                              updateConfig((draft) => {
                                draft.testConfig = draft.testConfig || { features: [], testers: [] };
                                draft.testConfig.features = features;
                              });
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <Space style={{ marginBottom: 8 }}>
                          <Typography.Text strong>测试用户</Typography.Text>
                          <Tag>{normalizeTags(testConfig.testers).length} users</Tag>
                        </Space>
                        <TagEditor
                          value={normalizeTags(testConfig.testers)}
                          onChange={(testers) => {
                            updateConfig((draft) => {
                              draft.testConfig = draft.testConfig || { features: [], testers: [] };
                              draft.testConfig.testers = testers;
                            });
                          }}
                        />
                        <Space wrap style={{ marginTop: 8 }}>
                          <Button size="small" onClick={() => addUsersTo("test", vipUsers)}>VIP 名单</Button>
                          <Button size="small" onClick={() => addUsersTo("test", internalUsers)}>内部测试用户</Button>
                        </Space>
                      </div>
                    </Space>
                  </Card>
                </Space>
              ),
            },
            {
              key: "canary",
              label: "金丝雀",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">仅 Canaries 列表中的用户可见。</Typography.Text>
                  <Card size="small">
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <div>
                        <Typography.Text strong>功能列表</Typography.Text>
                        <div style={{ marginTop: 8 }}>
                          <TagEditor
                            value={normalizeTags(canaryConfig.features)}
                            options={featureOptions}
                            onChange={(features) => {
                              updateConfig((draft) => {
                                draft.canaryConfig = draft.canaryConfig || { features: [], canaries: [] };
                                draft.canaryConfig.features = features;
                              });
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <Space style={{ marginBottom: 8 }}>
                          <Typography.Text strong>灰度用户</Typography.Text>
                          <Tag>{normalizeTags(canaryConfig.canaries).length} users</Tag>
                        </Space>
                        <TagEditor
                          value={normalizeTags(canaryConfig.canaries)}
                          onChange={(canaries) => {
                            updateConfig((draft) => {
                              draft.canaryConfig = draft.canaryConfig || { features: [], canaries: [] };
                              draft.canaryConfig.canaries = canaries;
                            });
                          }}
                        />
                        <Space wrap style={{ marginTop: 8 }}>
                          <Button size="small" onClick={() => addUsersTo("canary", vipUsers)}>VIP 名单</Button>
                          <Button size="small" onClick={() => addUsersTo("canary", internalUsers)}>内部测试用户</Button>
                        </Space>
                      </div>
                    </Space>
                  </Card>
                </Space>
              ),
            },
          ]}
        />

        <Collapse
          size="small"
          style={{ marginTop: 16 }}
          items={[
            {
              key: "keys",
              label: "查看所有功能键",
              children: (
                <Row gutter={[8, 8]}>
                  {featureOptions.length ? featureOptions.map((item) => (
                    <Col xs={24} md={12} xl={8} key={item.value}>
                      <Card size="small">
                        <Typography.Text code>{item.value}</Typography.Text>
                        <br />
                        <Typography.Text type="secondary">{translations[item.value]}</Typography.Text>
                      </Card>
                    </Col>
                  )) : (
                    <Col span={24}>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无功能键" />
                    </Col>
                  )}
                </Row>
              ),
            },
          ]}
        />

        <Modal
          open={diffOpen}
          title="确认变更"
          width={820}
          okText="确认发布"
          cancelText="取消"
          confirmLoading={publishMutation.isPending}
          onOk={() => publishMutation.mutate(config)}
          onCancel={() => setDiffOpen(false)}
        >
          <Typography.Paragraph type="secondary">
            请确认变更后再发布 <span style={{ color: "#27ae60", fontWeight: 600 }}>新增</span>{" "}
            <span style={{ color: "#e74c3c", fontWeight: 600 }}>删除</span>
          </Typography.Paragraph>
          <pre
            className="ff-diff-output"
            dangerouslySetInnerHTML={{ __html: diffHtml }}
          />
        </Modal>
      </PageSection>
    </PermissionGuard>
  );
}
