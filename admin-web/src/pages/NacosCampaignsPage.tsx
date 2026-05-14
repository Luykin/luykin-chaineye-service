import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  List,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { CopyOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SendOutlined, SyncOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { JsonEditorCard } from "@/components/ui/JsonEditorCard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchAllWebsiteCampaigns,
  fetchNacosConfig,
  publishNacosConfig,
  syncWebsiteCampaignsFromNacos,
} from "@/services/nacos";

type CampaignRecord = Record<string, unknown>;

interface CampaignConfig extends Record<string, unknown> {
  version?: number;
  campaigns: CampaignRecord[];
}

const DATA_ID = "xhunt_campaigns";
const GROUP = "DEFAULT_GROUP";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeConfig(value: unknown): CampaignConfig {
  const base = value && typeof value === "object" && !Array.isArray(value) ? (value as CampaignConfig) : ({ campaigns: [] } as CampaignConfig);
  if (Array.isArray(value)) base.campaigns = value as CampaignRecord[];
  if (!Array.isArray(base.campaigns)) base.campaigns = [];
  base.version = Number.isFinite(Number(base.version)) ? Number(base.version) : 3;
  return base;
}

function parseCampaignConfig(content?: string): CampaignConfig {
  if (!content) return { version: 3, campaigns: [] };
  return normalizeConfig(JSON.parse(content));
}

function getCampaignKey(item?: CampaignRecord | null) {
  if (!item) return "";
  return String(item.campaignKey || item.twitterHandle || "");
}

function getCampaignId(item?: CampaignRecord | null) {
  if (!item) return "";
  return String(item.id || item.nacosCampaignId || (getCampaignKey(item) ? `${getCampaignKey(item)}-hunter` : ""));
}

function getCampaignTitle(item: CampaignRecord) {
  const displayName = item.displayName as Record<string, unknown> | undefined;
  const copy = item.copy as Record<string, unknown> | undefined;
  const copyTitle = copy?.title as Record<string, unknown> | undefined;
  return String(
    displayName?.zh ||
      displayName?.en ||
      copyTitle?.zh ||
      copyTitle?.en ||
      item.title ||
      getCampaignKey(item) ||
      getCampaignId(item) ||
      "未命名活动"
  );
}

function getByPath(target: CampaignRecord | null, path: string[]) {
  let current: unknown = target;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setByPath(target: CampaignRecord, path: string[], value: unknown) {
  let current: Record<string, unknown> = target;
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      current[segment] = value;
      return;
    }
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
}

function toDatetimeLocal(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function NacosCampaignsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<CampaignConfig>({ version: 3, campaigns: [] });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [selectedJson, setSelectedJson] = useState("");
  const [dirty, setDirty] = useState(false);

  const query = useQuery({
    queryKey: ["nacos-campaigns"],
    queryFn: () => fetchNacosConfig({ dataId: DATA_ID, group: GROUP }),
  });

  const websiteQuery = useQuery({
    queryKey: ["website-campaigns"],
    queryFn: fetchAllWebsiteCampaigns,
  });

  useEffect(() => {
    if (!query.data?.data.content || dirty) return;
    try {
      const parsed = parseCampaignConfig(query.data.data.content);
      setConfig(parsed);
      setSelectedIndex(parsed.campaigns.length ? 0 : -1);
    } catch (error) {
      messageApi.error(error instanceof Error ? `Nacos 配置解析失败：${error.message}` : "Nacos 配置解析失败");
      setConfig({ version: 3, campaigns: [] });
      setSelectedIndex(-1);
    }
  }, [dirty, messageApi, query.data?.data.content]);

  const selectedCampaign = selectedIndex >= 0 ? config.campaigns[selectedIndex] || null : null;

  useEffect(() => {
    setSelectedJson(selectedCampaign ? JSON.stringify(selectedCampaign, null, 2) : "");
  }, [selectedCampaign]);

  const publishMutation = useMutation({
    mutationFn: () =>
      publishNacosConfig({
        dataId: DATA_ID,
        group: GROUP,
        content: JSON.stringify(config, null, 2),
        source: "nacos-campaigns",
      }),
    onSuccess: () => {
      messageApi.success("活动配置已发布");
      setDirty(false);
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "活动配置发布失败");
    },
  });

  const syncWebsiteMutation = useMutation({
    mutationFn: () => syncWebsiteCampaignsFromNacos(false),
    onSuccess: () => {
      messageApi.success("已触发同步到网站");
      void websiteQuery.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "同步网站失败");
    },
  });

  const filteredCampaigns = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return config.campaigns
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!keyword) return true;
        const hay = [getCampaignId(item), getCampaignKey(item), getCampaignTitle(item), JSON.stringify(item)].join(" ").toLowerCase();
        return hay.includes(keyword);
      });
  }, [config.campaigns, search]);

  const selectedJsonValid = useMemo(() => {
    try {
      JSON.parse(selectedJson || "{}");
      return true;
    } catch {
      return false;
    }
  }, [selectedJson]);

  const websiteRows = websiteQuery.data?.data || [];
  const currentWebsiteRows = websiteRows.filter((item) => item.nacosCampaignId === getCampaignId(selectedCampaign));

  function updateConfig(updater: (draft: CampaignConfig) => void) {
    const next = clone(config);
    updater(next);
    setConfig(next);
    setDirty(true);
  }

  function patchSelected(mutator: (draft: CampaignRecord) => void) {
    if (selectedIndex < 0) return;
    updateConfig((draft) => {
      const campaign = clone(draft.campaigns[selectedIndex]);
      mutator(campaign);
      draft.campaigns[selectedIndex] = campaign;
    });
  }

  function reload() {
    if (dirty && !window.confirm("当前有未发布修改，确认重新加载并丢弃修改吗？")) return;
    setDirty(false);
    void query.refetch();
  }

  function addCampaign() {
    const newItem: CampaignRecord = {
      id: "",
      campaignKey: "",
      enabled: false,
      testingPhase: true,
      sortWeight: 0,
      displayName: { zh: "新活动", en: "New Campaign" },
      copy: { shortTitle: { zh: "", en: "" } },
      targetUserIds: [],
      showSponsoredPolicy: true,
    };
    updateConfig((draft) => {
      draft.campaigns.unshift(newItem);
    });
    setSelectedIndex(0);
  }

  function duplicateCampaign() {
    if (!selectedCampaign) return;
    const copied = clone(selectedCampaign);
    copied.id = "";
    copied.enabled = false;
    copied.testingPhase = false;
    updateConfig((draft) => {
      draft.campaigns.splice(selectedIndex + 1, 0, copied);
    });
    setSelectedIndex(selectedIndex + 1);
  }

  function deleteCampaign() {
    if (selectedIndex < 0) return;
    updateConfig((draft) => {
      draft.campaigns.splice(selectedIndex, 1);
    });
    setSelectedIndex(-1);
  }

  function applyJsonToSelected() {
    try {
      const parsed = JSON.parse(selectedJson || "{}");
      updateConfig((draft) => {
        draft.campaigns[selectedIndex] = parsed;
      });
      messageApi.success("已应用当前 JSON 修改");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "JSON 解析失败");
    }
  }

  function setCampaignKey(value: string) {
    patchSelected((draft) => {
      draft.campaignKey = value;
      draft.id = value ? `${value}-hunter` : "";
    });
  }

  return (
    <PermissionGuard permission="nacos_config">
      {contextHolder}
      <PageSection title="Xhunt Earn 活动配置" description="可视化编辑 Nacos 配置：xhunt_campaigns。">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" styles={{ body: { padding: 12 } }}>
            <div className="nacos-legacy-toolbar">
              <div className="nacos-legacy-toolbar-left">
                <Typography.Text type="secondary">dataId: <Typography.Text code>{DATA_ID}</Typography.Text></Typography.Text>
                <Typography.Text type="secondary">group: <Typography.Text code>{GROUP}</Typography.Text></Typography.Text>
              </div>
              <Space wrap>
                <Input.Search placeholder="搜索活动..." value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 220 }} allowClear />
                <Button type="primary" icon={<ReloadOutlined />} loading={query.isFetching} onClick={reload}>刷新</Button>
                <Button icon={<PlusOutlined />} onClick={addCampaign}>新增</Button>
                <Button icon={<CopyOutlined />} disabled={!selectedCampaign} onClick={duplicateCampaign}>复制</Button>
                <Popconfirm title="确认删除当前活动？" disabled={!selectedCampaign} onConfirm={deleteCampaign}>
                  <Button danger icon={<DeleteOutlined />} disabled={!selectedCampaign}>删除</Button>
                </Popconfirm>
                <Button type="primary" icon={<SendOutlined />} disabled={!dirty} loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>发布</Button>
                <Button icon={<SyncOutlined />} loading={syncWebsiteMutation.isPending} onClick={() => syncWebsiteMutation.mutate()}>同步到网站</Button>
              </Space>
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8} xl={7}>
              <Card size="small" title="活动列表" extra={<Tag>{filteredCampaigns.length}</Tag>} styles={{ body: { padding: 0 } }}>
                <div style={{ maxHeight: 680, overflow: "auto" }}>
                  {filteredCampaigns.length ? (
                    <List
                      dataSource={filteredCampaigns}
                      renderItem={({ item, index }) => {
                        const active = index === selectedIndex;
                        return (
                          <List.Item key={`${getCampaignId(item)}-${index}`} onClick={() => setSelectedIndex(index)} className={active ? "nacos-list-item is-active" : "nacos-list-item"}>
                            <Space direction="vertical" size={4} style={{ width: "100%" }}>
                              <Space wrap>
                                <Typography.Text strong>{getCampaignTitle(item)}</Typography.Text>
                                <Tag color={item.enabled ? "success" : "default"}>{item.enabled ? "展示中" : "关闭"}</Tag>
                                {item.testingPhase ? <Tag color="warning">测试</Tag> : null}
                              </Space>
                              <Typography.Text type="secondary">{getCampaignId(item) || "未设置 id"}</Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>campaignKey: {getCampaignKey(item) || "-"}</Typography.Text>
                            </Space>
                          </List.Item>
                        );
                      }}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活动配置" style={{ padding: 24 }} />
                  )}
                </div>
              </Card>
            </Col>

            <Col xs={24} lg={16} xl={17}>
              <Card size="small" title="编辑活动" extra={<Typography.Text type="secondary">{selectedCampaign ? `正在编辑：${getCampaignId(selectedCampaign) || "未设置 id"}` : "选择左侧活动开始编辑"}</Typography.Text>}>
                {selectedCampaign ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <div className="campaign-status-control-react">
                      <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                        <Typography.Text strong>展示活动</Typography.Text>
                        <Switch checked={Boolean(selectedCampaign.enabled)} onChange={(checked) => patchSelected((draft) => { draft.enabled = checked; })} />
                      </Space>
                      <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                        <Typography.Text>测试模式（仅内部可见）</Typography.Text>
                        <Switch checked={Boolean(selectedCampaign.testingPhase)} onChange={(checked) => patchSelected((draft) => { draft.testingPhase = checked; })} />
                      </Space>
                    </div>

                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={16}>
                        <Typography.Text strong>活动ID</Typography.Text>
                        <Input value={getCampaignKey(selectedCampaign)} onChange={(event) => setCampaignKey(event.target.value.trim())} placeholder="例如：mantle3, bybit2" />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>内部 id 会自动生成：campaignKey + '-hunter'</Typography.Text>
                      </Col>
                      <Col xs={24} md={8}>
                        <Typography.Text strong>排序权重</Typography.Text>
                        <Input value={String(selectedCampaign.sortWeight ?? 0)} onChange={(event) => patchSelected((draft) => { draft.sortWeight = toNumber(event.target.value) || 0; })} />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>数值越大越靠前</Typography.Text>
                      </Col>
                    </Row>

                    <Card size="small" title="活动信息">
                      <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>标题（中文）</Typography.Text>
                          <Input value={String(getByPath(selectedCampaign, ["displayName", "zh"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["displayName", "zh"], event.target.value))} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>标题（English）</Typography.Text>
                          <Input value={String(getByPath(selectedCampaign, ["displayName", "en"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["displayName", "en"], event.target.value))} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>短标题（中文）</Typography.Text>
                          <Input value={String(getByPath(selectedCampaign, ["copy", "shortTitle", "zh"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["copy", "shortTitle", "zh"], event.target.value))} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>短标题（English）</Typography.Text>
                          <Input value={String(getByPath(selectedCampaign, ["copy", "shortTitle", "en"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["copy", "shortTitle", "en"], event.target.value))} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>项目介绍（中文）</Typography.Text>
                          <Input.TextArea rows={2} value={String(getByPath(selectedCampaign, ["copy", "projectIntroduction", "zh"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["copy", "projectIntroduction", "zh"], event.target.value))} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>项目介绍（English）</Typography.Text>
                          <Input.TextArea rows={2} value={String(getByPath(selectedCampaign, ["copy", "projectIntroduction", "en"]) || "")} onChange={(event) => patchSelected((draft) => setByPath(draft, ["copy", "projectIntroduction", "en"], event.target.value))} />
                        </Col>
                      </Row>
                    </Card>

                    <Card size="small" title="时间、奖励与门槛">
                      <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>开始时间</Typography.Text>
                          <Input type="datetime-local" value={toDatetimeLocal(selectedCampaign.startAt)} onChange={(event) => patchSelected((draft) => { draft.startAt = fromDatetimeLocal(event.target.value); })} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Typography.Text strong>结束时间</Typography.Text>
                          <Input type="datetime-local" value={toDatetimeLocal(selectedCampaign.endAt)} onChange={(event) => patchSelected((draft) => { draft.endAt = fromDatetimeLocal(event.target.value); })} />
                        </Col>
                        <Col xs={24} md={8}>
                          <Typography.Text strong>奖励金额</Typography.Text>
                          <Input value={String(selectedCampaign.rewardAmount ?? "")} onChange={(event) => patchSelected((draft) => { draft.rewardAmount = toNumber(event.target.value); })} />
                        </Col>
                        <Col xs={24} md={8}>
                          <Typography.Text strong>人数</Typography.Text>
                          <Input value={String(selectedCampaign.rewardParticipantCount ?? "")} onChange={(event) => patchSelected((draft) => { draft.rewardParticipantCount = toNumber(event.target.value); })} />
                        </Col>
                        <Col xs={24} md={8}>
                          <Typography.Text strong>分配机制</Typography.Text>
                          <Select
                            value={String(selectedCampaign.rewardDistributionType || "")}
                            onChange={(value) => patchSelected((draft) => { draft.rewardDistributionType = value; })}
                            options={[{ value: "", label: "请选择" }, { value: "equal", label: "平分" }, { value: "mindshare", label: "mindshare" }, { value: "workshare", label: "workshare" }]}
                            style={{ width: "100%" }}
                          />
                        </Col>
                        <Col xs={24} md={8}>
                          <Typography.Text strong>奖励单位</Typography.Text>
                          <Input value={String(selectedCampaign.rewardUnit || "")} onChange={(event) => patchSelected((draft) => { draft.rewardUnit = event.target.value; })} placeholder="USDT" />
                        </Col>
                        <Col xs={24} md={8}>
                          <Space align="center" style={{ justifyContent: "space-between", width: "100%", marginTop: 24 }}>
                            <Typography.Text>早期项目风险提示</Typography.Text>
                            <Switch checked={Boolean(selectedCampaign.hasRiskConfirm)} onChange={(checked) => patchSelected((draft) => { draft.hasRiskConfirm = checked; })} />
                          </Space>
                        </Col>
                        <Col xs={24} md={8}>
                          <Space align="center" style={{ justifyContent: "space-between", width: "100%", marginTop: 24 }}>
                            <Typography.Text>显示付费推广政策</Typography.Text>
                            <Switch checked={selectedCampaign.showSponsoredPolicy !== false} onChange={(checked) => patchSelected((draft) => { draft.showSponsoredPolicy = checked; })} />
                          </Space>
                        </Col>
                      </Row>
                    </Card>

                    <Collapse
                      size="small"
                      items={[
                        {
                          key: "json",
                          label: "高级配置（完整 JSON）",
                          children: (
                            <JsonEditorCard
                              title="当前活动 JSON 编辑器"
                              description="用于编辑单个活动的完整 JSON。应用后会同步到当前列表，发布时提交完整 xhunt_campaigns 对象。"
                              value={selectedJson}
                              onChange={setSelectedJson}
                              height={320}
                              extra={
                                <Space>
                                  <Tag color={selectedJsonValid ? "success" : "error"}>{selectedJsonValid ? "JSON 有效" : "JSON 无效"}</Tag>
                                  <Button size="small" disabled={!selectedJsonValid} onClick={applyJsonToSelected}>应用到当前活动</Button>
                                </Space>
                              }
                            />
                          ),
                        },
                        {
                          key: "website",
                          label: `网站侧记录 (${currentWebsiteRows.length})`,
                          children: currentWebsiteRows.length ? (
                            <List
                              dataSource={currentWebsiteRows}
                              renderItem={(item) => (
                                <List.Item key={item.nacosCampaignId}>
                                  <List.Item.Meta
                                    title={<Space><Typography.Text strong>{item.displayNameZh || item.displayNameEn || item.campaignKey || item.nacosCampaignId}</Typography.Text><Tag>{item.webStatus || "draft"}</Tag></Space>}
                                    description={<Typography.Text type="secondary">slug: {item.slug || "-"}</Typography.Text>}
                                  />
                                </List.Item>
                              )}
                            />
                          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前活动暂无网站侧记录" />,
                        },
                      ]}
                    />
                  </Space>
                ) : (
                  <Empty description="请选择一个活动" />
                )}
              </Card>
            </Col>
          </Row>

          {query.isError || websiteQuery.isError ? <Alert type="error" showIcon message="活动配置加载失败" /> : null}
        </Space>
      </PageSection>
    </PermissionGuard>
  );
}
