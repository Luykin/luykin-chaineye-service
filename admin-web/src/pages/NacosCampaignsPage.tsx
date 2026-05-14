import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  List,
  Popconfirm,
  Row,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
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

const DATA_ID = "xhunt_campaigns";

function parseCampaigns(content?: string): CampaignRecord[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cloneCampaign<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getCampaignId(item: CampaignRecord) {
  return String(item.twitterHandle || item.campaignKey || item.id || "");
}

function getCampaignTitle(item: CampaignRecord) {
  const displayName = item.displayName as Record<string, unknown> | undefined;
  return String(
    displayName?.zh ||
      displayName?.en ||
      item.title ||
      item.twitterHandle ||
      item.campaignKey ||
      "未命名活动"
  );
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

export function NacosCampaignsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedJson, setSelectedJson] = useState("");

  const query = useQuery({
    queryKey: ["nacos-campaigns"],
    queryFn: () => fetchNacosConfig({ dataId: DATA_ID }),
  });
  const websiteQuery = useQuery({
    queryKey: ["website-campaigns"],
    queryFn: fetchAllWebsiteCampaigns,
  });

  useEffect(() => {
    const parsed = parseCampaigns(query.data?.data.content);
    setCampaigns(parsed);
    if (!selectedId && parsed.length) {
      setSelectedId(getCampaignId(parsed[0]));
    }
  }, [query.data?.data.content, selectedId]);

  const publishMutation = useMutation({
    mutationFn: (content: string) =>
      publishNacosConfig({
        dataId: DATA_ID,
        content,
        source: "nacos-campaigns",
      }),
    onSuccess: () => {
      messageApi.success("活动配置已发布");
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

  const selectedCampaign = useMemo(
    () => campaigns.find((item) => getCampaignId(item) === selectedId) || null,
    [campaigns, selectedId]
  );

  useEffect(() => {
    setSelectedJson(selectedCampaign ? JSON.stringify(selectedCampaign, null, 2) : "");
  }, [selectedCampaign]);

  const filteredCampaigns = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return campaigns.filter((item) => {
      if (!keyword) return true;
      const haystack = JSON.stringify(item).toLowerCase();
      return haystack.includes(keyword);
    });
  }, [campaigns, search]);

  const selectedJsonValid = useMemo(() => {
    try {
      JSON.parse(selectedJson || "{}");
      return true;
    } catch {
      return false;
    }
  }, [selectedJson]);

  const fullJsonValid = useMemo(() => {
    try {
      JSON.stringify(campaigns);
      return true;
    } catch {
      return false;
    }
  }, [campaigns]);

  const websiteRows = websiteQuery.data?.data || [];

  function patchSelectedCampaign(mutator: (draft: CampaignRecord) => void) {
    if (!selectedCampaign) return;
    const next = cloneCampaign(selectedCampaign);
    mutator(next);
    const nextId = getCampaignId(next) || selectedId;
    setCampaigns((current) =>
      current.map((item) => (getCampaignId(item) === selectedId ? next : item))
    );
    setSelectedId(nextId);
    setSelectedJson(JSON.stringify(next, null, 2));
  }

  function applyJsonToSelected() {
    try {
      const parsed = JSON.parse(selectedJson || "{}");
      setCampaigns((current) =>
        current.map((item) => (getCampaignId(item) === selectedId ? parsed : item))
      );
      setSelectedId(getCampaignId(parsed) || selectedId);
      messageApi.success("已应用当前 JSON 修改");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "JSON 解析失败");
    }
  }

  return (
    <PermissionGuard permission="nacos_config">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="活动配置"
          description="编辑 Nacos 活动配置 xhunt_campaigns，并支持同步到网站数据库。"
          extra={
            <Space wrap>
              <Button onClick={() => void query.refetch()}>刷新</Button>
              <Button onClick={() => {
                const newItem: CampaignRecord = {
                  twitterHandle: `campaign_${Date.now()}`,
                  enabled: false,
                  testingPhase: true,
                  sortWeight: 0,
                  displayName: { zh: "新活动", en: "New Campaign" },
                };
                setCampaigns((current) => [newItem, ...current]);
                setSelectedId(getCampaignId(newItem));
              }}>
                新增
              </Button>
              <Button
                disabled={!selectedCampaign}
                onClick={() => {
                  if (!selectedCampaign) return;
                  const cloned = cloneCampaign(selectedCampaign);
                  cloned.twitterHandle = `${getCampaignId(selectedCampaign)}_copy`;
                  setCampaigns((current) => [cloned, ...current]);
                  setSelectedId(getCampaignId(cloned));
                }}
              >
                复制
              </Button>
              <Popconfirm
                title="确认删除当前活动？"
                disabled={!selectedCampaign}
                onConfirm={() => {
                  setCampaigns((current) => current.filter((item) => getCampaignId(item) !== selectedId));
                  setSelectedId("");
                }}
              >
                <Button danger disabled={!selectedCampaign}>删除</Button>
              </Popconfirm>
              <Button
                type="primary"
                disabled={!fullJsonValid}
                loading={publishMutation.isPending}
                onClick={() => publishMutation.mutate(JSON.stringify(campaigns, null, 2))}
              >
                发布
              </Button>
              <Button loading={syncWebsiteMutation.isPending} onClick={() => syncWebsiteMutation.mutate()}>
                同步到网站
              </Button>
            </Space>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={7}>
              <Card title="活动列表" extra={<Tag color="blue">{filteredCampaigns.length}</Tag>}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Input placeholder="搜索活动..." value={search} onChange={(event) => setSearch(event.target.value)} />
                  <div style={{ maxHeight: 620, overflow: "auto" }}>
                    {filteredCampaigns.length ? (
                      <List
                        dataSource={filteredCampaigns}
                        renderItem={(item) => {
                          const id = getCampaignId(item);
                          const active = id === selectedId;
                          return (
                            <List.Item
                              key={id}
                              onClick={() => setSelectedId(id)}
                              style={{
                                cursor: "pointer",
                                padding: 12,
                                borderRadius: 10,
                                marginBottom: 8,
                                background: active ? "#eff6ff" : "#fff",
                                border: active ? "1px solid #93c5fd" : "1px solid #f1f5f9",
                              }}
                            >
                              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                                <Space wrap>
                                  <Typography.Text strong>{getCampaignTitle(item)}</Typography.Text>
                                  <Tag color={item.enabled ? "success" : "default"}>
                                    {item.enabled ? "展示中" : "关闭"}
                                  </Tag>
                                  {item.testingPhase ? <Tag color="warning">测试</Tag> : null}
                                </Space>
                                <Typography.Text type="secondary">{id}</Typography.Text>
                              </Space>
                            </List.Item>
                          );
                        }}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活动配置" />
                    )}
                  </div>
                </Space>
              </Card>
            </Col>

            <Col xs={24} xl={10}>
              <Card title="核心字段编辑">
                {selectedCampaign ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <Input
                      addonBefore="活动ID"
                      value={String(selectedCampaign.twitterHandle || "")}
                      onChange={(event) =>
                        patchSelectedCampaign((draft) => {
                          draft.twitterHandle = event.target.value;
                        })
                      }
                    />
                    <Input
                      addonBefore="标题(中文)"
                      value={String((selectedCampaign.displayName as Record<string, unknown> | undefined)?.zh || "")}
                      onChange={(event) =>
                        patchSelectedCampaign((draft) => {
                          setByPath(draft, ["displayName", "zh"], event.target.value);
                        })
                      }
                    />
                    <Input
                      addonBefore="标题(English)"
                      value={String((selectedCampaign.displayName as Record<string, unknown> | undefined)?.en || "")}
                      onChange={(event) =>
                        patchSelectedCampaign((draft) => {
                          setByPath(draft, ["displayName", "en"], event.target.value);
                        })
                      }
                    />
                    <Input
                      addonBefore="排序权重"
                      value={String(selectedCampaign.sortWeight ?? 0)}
                      onChange={(event) =>
                        patchSelectedCampaign((draft) => {
                          draft.sortWeight = Number(event.target.value || 0);
                        })
                      }
                    />
                    <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                      <Typography.Text>展示活动</Typography.Text>
                      <Switch
                        checked={Boolean(selectedCampaign.enabled)}
                        onChange={(checked) =>
                          patchSelectedCampaign((draft) => {
                            draft.enabled = checked;
                          })
                        }
                      />
                    </Space>
                    <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                      <Typography.Text>测试模式</Typography.Text>
                      <Switch
                        checked={Boolean(selectedCampaign.testingPhase)}
                        onChange={(checked) =>
                          patchSelectedCampaign((draft) => {
                            draft.testingPhase = checked;
                          })
                        }
                      />
                    </Space>
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="当前活动标题">{getCampaignTitle(selectedCampaign)}</Descriptions.Item>
                      <Descriptions.Item label="网站同步记录">
                        {websiteRows.filter((item) => item.nacosCampaignId === selectedId).length || 0}
                      </Descriptions.Item>
                    </Descriptions>
                  </Space>
                ) : (
                  <Empty description="请选择一个活动开始编辑" />
                )}
              </Card>
            </Col>

            <Col xs={24} xl={7}>
              <Card title="网站侧记录">
                <div style={{ maxHeight: 620, overflow: "auto" }}>
                  {websiteRows.length ? (
                    <List
                      dataSource={websiteRows.slice(0, 50)}
                      renderItem={(item) => (
                        <List.Item key={item.nacosCampaignId}>
                          <List.Item.Meta
                            title={
                              <Space wrap>
                                <Typography.Text strong>
                                  {item.displayNameZh || item.displayNameEn || item.campaignKey || item.nacosCampaignId}
                                </Typography.Text>
                                <Tag>{item.webStatus || "draft"}</Tag>
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size={0}>
                                <Typography.Text type="secondary">{item.nacosCampaignId}</Typography.Text>
                                <Typography.Text type="secondary">
                                  slug: {item.slug || "-"}
                                </Typography.Text>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无网站侧活动记录" />
                  )}
                </div>
              </Card>
            </Col>
          </Row>

          <div style={{ marginTop: 16 }}>
            <JsonEditorCard
              title="当前活动 JSON 编辑器"
              description="用于编辑单个活动的完整 JSON。应用后会同步到当前列表，发布时再统一提交整个数组。"
              value={selectedJson}
              onChange={setSelectedJson}
              height={360}
              extra={
                <Space>
                  <Tag color={selectedJsonValid ? "success" : "error"}>
                    {selectedJsonValid ? "JSON 有效" : "JSON 无效"}
                  </Tag>
                  <Button size="small" disabled={!selectedCampaign || !selectedJsonValid} onClick={applyJsonToSelected}>
                    应用到当前活动
                  </Button>
                </Space>
              }
            />
          </div>

          {query.isError || websiteQuery.isError ? (
            <Alert style={{ marginTop: 16 }} type="error" showIcon message="活动配置加载失败" />
          ) : null}
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
