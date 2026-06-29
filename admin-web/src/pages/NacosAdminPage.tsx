import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CloudServerOutlined,
  CodeOutlined,
  DeleteOutlined,
  FileAddOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  deleteNacosAdminConfig,
  fetchNacosAdminConfig,
  fetchNacosAdminConfigHistory,
  fetchNacosAdminConfigSnapshot,
  fetchNacosAdminConfigs,
  fetchNacosAdminNativeHistory,
  fetchNacosAdminNativeHistoryDetail,
  publishNacosAdminConfig,
} from "@/services/nacos";
import type { NacosAdminConfigMeta, NacosAdminConfigSnapshot, NacosNativeHistoryItem } from "@/types/nacos";

const { TextArea } = Input;
const DEFAULT_GROUP = "DEFAULT_GROUP";

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function normalizeJson(content: string) {
  return JSON.stringify(JSON.parse(content || "{}"), null, 2);
}

function shortHash(hash?: string | null) {
  if (!hash) return "-";
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function formatDateTime(value?: number | string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function getActionMeta(action: string) {
  const map: Record<string, { label: string; color: string }> = {
    sync_current: { label: "当前同步", color: "blue" },
    backup_before_publish: { label: "发布前备份", color: "gold" },
    publish: { label: "发布版本", color: "green" },
    delete_backup: { label: "删除前备份", color: "red" },
  };
  return map[action] || { label: action || "未知", color: "default" };
}

function getNativeActionMeta(opType?: string) {
  const normalized = String(opType || "").toUpperCase();
  if (normalized === "I") return { label: "新增", color: "green" };
  if (normalized === "U") return { label: "更新", color: "blue" };
  if (normalized === "D") return { label: "删除", color: "red" };
  return { label: opType || "变更", color: "default" };
}

function ConfigItem({ item, active, onClick }: { item: NacosAdminConfigMeta; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border: active ? "1px solid #2563eb" : "1px solid var(--ant-color-border)",
        borderRadius: 14,
        padding: 12,
        background: active ? "rgba(37, 99, 235, 0.10)" : "var(--ant-color-bg-container)",
        cursor: "pointer",
      }}
    >
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Text strong>{item.label}</Typography.Text>
          {item.publicReadable ? <Tag color="green">公网只读</Tag> : <Tag>内部</Tag>}
        </Space>
        <Typography.Text code copyable={{ text: item.dataId }}>
          {item.dataId}
        </Typography.Text>
        <Space wrap size={4}>
          <Tag>{item.group}</Tag>
          <Tag color={item.type === "json" ? "blue" : "default"}>{item.type}</Tag>
        </Space>
      </Space>
    </button>
  );
}

export function NacosAdminPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [selected, setSelected] = useState<{ dataId: string; group: string; tenant?: string } | null>(null);
  const [content, setContent] = useState("");
  const [type, setType] = useState("json");
  const [reason, setReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingSnapshotId, setLoadingSnapshotId] = useState<number | null>(null);
  const [createForm] = Form.useForm<{ dataId: string; group: string; type: string; content: string; reason?: string }>();

  const listQuery = useQuery({
    queryKey: ["nacos-admin-configs"],
    queryFn: fetchNacosAdminConfigs,
  });

  const configs = listQuery.data?.data.configs || [];

  useEffect(() => {
    if (!selected && configs.length) {
      setSelected({ dataId: configs[0].dataId, group: configs[0].group });
    }
  }, [configs, selected]);

  const detailQuery = useQuery({
    queryKey: ["nacos-admin-config", selected?.dataId, selected?.group, selected?.tenant],
    queryFn: () => fetchNacosAdminConfig(selected!),
    enabled: !!selected,
  });

  const detail = detailQuery.data?.data || null;

  const nativeHistoryQuery = useQuery({
    queryKey: ["nacos-admin-native-history", selected?.dataId, selected?.group, selected?.tenant, detail?.contentSha256],
    queryFn: () => fetchNacosAdminNativeHistory({ ...selected!, pageNo: 1, pageSize: 20 }),
    enabled: !!selected && !!detail,
  });

  const snapshotHistoryQuery = useQuery({
    queryKey: ["nacos-admin-config-history", selected?.dataId, selected?.group, selected?.tenant, detail?.contentSha256],
    queryFn: () => fetchNacosAdminConfigHistory({ ...selected!, limit: 30 }),
    enabled: !!selected && !!detail,
  });

  const nativeHistory = nativeHistoryQuery.data?.data.pageItems || [];
  const snapshotHistory = snapshotHistoryQuery.data?.data || [];
  const latestNativeHistory = nativeHistory[0] || null;
  const latestSnapshot = snapshotHistory[0] || null;
  const latestChangeTime = latestNativeHistory?.lastModifiedTime || latestNativeHistory?.createdTime || latestSnapshot?.createdAt || null;
  const latestAction = latestNativeHistory ? getNativeActionMeta(latestNativeHistory.opType) : latestSnapshot ? getActionMeta(latestSnapshot.action) : null;

  const selectedMeta = useMemo(
    () => configs.find((item) => item.dataId === selected?.dataId) || null,
    [configs, selected?.dataId]
  );
  const canWriteSelected = !!selectedMeta?.writable || !!listQuery.data?.data.canCreateCustom;

  useEffect(() => {
    if (detail) {
      setContent(detail.content || "");
      setType(detail.type || selectedMeta?.type || "json");
      setReason("");
    }
  }, [detail, selectedMeta?.type]);

  const originalContent = detail?.content || "";
  const changed = content !== originalContent;

  const publishMutation = useMutation({
    mutationFn: (payload: { dataId: string; group: string; tenant?: string; type: string; content: string; reason?: string }) =>
      publishNacosAdminConfig(payload),
    onSuccess: (resp) => {
      messageApi.success(resp.data?.changed === false ? "配置已发布（内容未变化）" : "配置已发布");
      void detailQuery.refetch();
      void nativeHistoryQuery.refetch();
      void snapshotHistoryQuery.refetch();
      void listQuery.refetch();
      setCreateOpen(false);
    },
    onError: (error: Error) => messageApi.error(error.message || "发布失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (payload: { dataId: string; group: string; tenant?: string; reason?: string }) => deleteNacosAdminConfig(payload),
    onSuccess: () => {
      messageApi.success("配置已删除");
      void nativeHistoryQuery.refetch();
      void snapshotHistoryQuery.refetch();
      setSelected(null);
      setContent("");
      void listQuery.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "删除失败"),
  });

  async function handleLoadNativeHistory(item: NacosNativeHistoryItem) {
    if (!selected) return;
    try {
      setLoadingSnapshotId(Number(item.id) || -1);
      const resp = await fetchNacosAdminNativeHistoryDetail({
        id: item.id,
        dataId: selected.dataId,
        group: selected.group,
        tenant: selected.tenant,
        source: item.source,
      });
      const next = resp.data;
      if (typeof next.content !== "string") {
        messageApi.warning("该 Nacos 历史详情没有返回内容，无法载入编辑器");
        return;
      }
      const nextType = next.content?.trim().startsWith("{") || next.content?.trim().startsWith("[") ? "json" : type;
      setType(nextType || "json");
      setContent(next.content);
      setReason(`从 Nacos 原生历史 #${next.id} 恢复编辑：${next.md5 || shortHash(next.contentSha256)}`);
      messageApi.success("Nacos 原生历史已载入编辑器，确认后需要点击发布保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "载入 Nacos 历史失败");
    } finally {
      setLoadingSnapshotId(null);
    }
  }

  async function handleLoadSnapshot(snapshot: NacosAdminConfigSnapshot) {
    try {
      setLoadingSnapshotId(snapshot.id);
      const resp = await fetchNacosAdminConfigSnapshot(snapshot.id);
      const next = resp.data;
      setType(next.type || "json");
      setContent(next.content || "");
      setReason(`从历史版本 #${next.id} 恢复编辑：${shortHash(next.contentSha256)}`);
      messageApi.success("历史版本已载入编辑器，确认后需要点击发布保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "载入历史版本失败");
    } finally {
      setLoadingSnapshotId(null);
    }
  }

  function handleFormatJson() {
    try {
      setContent(normalizeJson(content));
      messageApi.success("JSON 已格式化");
    } catch (error) {
      messageApi.error("当前内容不是合法 JSON");
    }
  }

  function handleSave() {
    if (!selected) return;
    if (type === "json") {
      try {
        normalizeJson(content);
      } catch (error) {
        messageApi.error("JSON 不合法，不能发布");
        return;
      }
    }
    publishMutation.mutate({
      dataId: selected.dataId,
      group: selected.group,
      tenant: selected.tenant,
      type,
      content,
      reason,
    });
  }

  function handleCreateSubmit() {
    createForm.validateFields().then((values) => {
      const nextType = values.type || "json";
      if (nextType === "json") {
        try {
          values.content = normalizeJson(values.content || "{}");
        } catch (error) {
          messageApi.error("JSON 不合法，不能创建");
          return;
        }
      }
      publishMutation.mutate({
        dataId: values.dataId.trim(),
        group: values.group || DEFAULT_GROUP,
        type: nextType,
        content: values.content || "",
        reason: values.reason,
      });
      setSelected({ dataId: values.dataId.trim(), group: values.group || DEFAULT_GROUP });
    });
  }

  return (
    <PermissionGuard permission="__super_only_nacos_admin__">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="Nacos 配置中心"
          description="自建配置管理页：读取、创建/更新、删除配置都走管理后台认证与权限，不暴露 Nacos 控制台。"
          extra={
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => { void listQuery.refetch(); void detailQuery.refetch(); }} loading={listQuery.isFetching || detailQuery.isFetching}>
                刷新
              </Button>
              <Button icon={<SafetyCertificateOutlined />} danger onClick={() => navigate("/nacos-security")}>
                安全检查
              </Button>
              <Button
                type="primary"
                icon={<FileAddOutlined />}
                disabled={!listQuery.data?.data.canCreateCustom}
                onClick={() => {
                  createForm.setFieldsValue({ group: DEFAULT_GROUP, type: "json", content: "{}" });
                  setCreateOpen(true);
                }}
              >
                新建配置
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="基础版配置中心"
            description="当前列表默认展示项目白名单配置；新建任意 dataId 需要 nacos-admin 权限。发布和删除会记录后台操作日志。"
          />

          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr) minmax(420px, 520px)", gap: 16, alignItems: "start" }}>
            <Card title="配置列表" styles={{ body: { padding: 12 } }}>
              {listQuery.isLoading ? (
                <Spin />
              ) : configs.length ? (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {configs.map((item) => (
                    <ConfigItem
                      key={item.dataId}
                      item={item}
                      active={selected?.dataId === item.dataId}
                      onClick={() => setSelected({ dataId: item.dataId, group: item.group })}
                    />
                  ))}
                </Space>
              ) : (
                <Empty description="暂无可管理配置" />
              )}
            </Card>

            <Card
              title={
                <Space wrap>
                  <CloudServerOutlined />
                  <span>{selected?.dataId || "请选择配置"}</span>
                  {detail?.publicReadable ? <Tag color="green">公网只读白名单</Tag> : null}
                </Space>
              }
              extra={
                <Space wrap>
                  <Select
                    size="small"
                    style={{ width: 96 }}
                    value={type}
                    onChange={setType}
                    options={[{ label: "JSON", value: "json" }, { label: "Text", value: "text" }]}
                  />
                  <Button size="small" icon={<CodeOutlined />} onClick={handleFormatJson} disabled={type !== "json"}>
                    格式化
                  </Button>
                </Space>
              }
            >
              {detailQuery.isFetching && !detail ? (
                <Spin />
              ) : selected ? (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <TextArea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    autoSize={{ minRows: 22, maxRows: 34 }}
                    spellCheck={false}
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 13 }}
                  />
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="变更原因（建议填写，便于审计）"
                    maxLength={500}
                    showCount
                  />
                  <Space wrap>
                    <Button type="primary" icon={<SaveOutlined />} disabled={!changed || !canWriteSelected} loading={publishMutation.isPending} onClick={handleSave}>
                      发布保存
                    </Button>
                    <Button onClick={() => setContent(originalContent)} disabled={!changed}>
                      放弃修改
                    </Button>
                  </Space>
                </Space>
              ) : (
                <Empty description="请选择左侧配置" />
              )}
            </Card>

            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card title="配置状态">
                {detail ? (
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">Group</Typography.Text>
                    <Typography.Text code>{detail.group}</Typography.Text>
                    <Typography.Text type="secondary">内容大小</Typography.Text>
                    <Typography.Text>{formatBytes(detail.contentLength)}</Typography.Text>
                    <Typography.Text type="secondary">当前版本 Hash</Typography.Text>
                    <Typography.Text copyable style={{ wordBreak: "break-all" }}>{detail.contentSha256}</Typography.Text>
                    <Typography.Text type="secondary">最近变动时间</Typography.Text>
                    <Typography.Text>{latestChangeTime ? formatDateTime(latestChangeTime) : "暂无历史记录"}</Typography.Text>
                    <Typography.Text type="secondary">最近动作</Typography.Text>
                    {latestAction ? <Tag color={latestAction.color}>{latestAction.label}</Tag> : <Tag>未入库</Tag>}
                    <Typography.Text type="secondary">权限</Typography.Text>
                    <Space wrap>{detail.permissions.map((permission) => <Tag key={permission}>{permission}</Tag>)}</Space>
                    <Typography.Text type="secondary">修改状态</Typography.Text>
                    {changed ? <Tag color="orange">有未发布修改</Tag> : <Tag color="green">已同步</Tag>}
                  </Space>
                ) : (
                  <Empty description="暂无配置详情" />
                )}
              </Card>

              <Card
                title={
                  <Space>
                    <HistoryOutlined />
                    <span>历史版本</span>
                  </Space>
                }
                extra={
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      void nativeHistoryQuery.refetch();
                      void snapshotHistoryQuery.refetch();
                    }}
                    loading={nativeHistoryQuery.isFetching || snapshotHistoryQuery.isFetching}
                  >
                    刷新
                  </Button>
                }
                styles={{ body: { padding: 12 } }}
              >
                {!selected ? (
                  <Empty description="请选择配置" />
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.92fr)", gap: 12 }}>
                    <Space direction="vertical" size={10} style={{ width: "100%", minHeight: 0 }}>
                      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                        <Typography.Text strong>Nacos 原生历史</Typography.Text>
                        <Tag color="blue">{nativeHistoryQuery.data?.data.source || "native"}</Tag>
                      </Space>
                      <div style={{ maxHeight: 520, overflowY: "auto", overscrollBehavior: "contain", paddingRight: 4 }}>
                      {nativeHistoryQuery.isFetching && !nativeHistory.length ? (
                        <Spin />
                      ) : nativeHistory.length ? (
                        nativeHistory.map((item) => {
                          const action = getNativeActionMeta(item.opType);
                          return (
                            <div
                              key={`${item.source}-${item.id}`}
                              style={{
                                border: "1px solid var(--ant-color-border)",
                                borderRadius: 12,
                                padding: 10,
                                marginBottom: 10,
                                background: "var(--ant-color-bg-container)",
                              }}
                            >
                              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                                  <Tag color={action.color}>{action.label}</Tag>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>#{item.id}</Typography.Text>
                                </Space>
                                <Typography.Text style={{ fontSize: 12 }}>
                                  {formatDateTime(item.lastModifiedTime || item.createdTime)}
                                </Typography.Text>
                                <Typography.Text copyable={item.md5 ? { text: item.md5 } : false} code style={{ maxWidth: "100%" }}>
                                  MD5 {shortHash(item.md5)}
                                </Typography.Text>
                                <Space wrap size={4}>
                                  {item.srcUser ? <Tag>{item.srcUser}</Tag> : null}
                                  {item.srcIp ? <Tag>{item.srcIp}</Tag> : null}
                                </Space>
                                <Button
                                  size="small"
                                  icon={<RollbackOutlined />}
                                  onClick={() => void handleLoadNativeHistory(item)}
                                  loading={loadingSnapshotId === (Number(item.id) || -1)}
                                  disabled={!canWriteSelected}
                                  block
                                >
                                  载入此版本
                                </Button>
                              </Space>
                            </div>
                          );
                        })
                      ) : (
                        <Empty description="Nacos 未返回历史记录" />
                      )}
                      </div>
                    </Space>

                    <Space direction="vertical" size={10} style={{ width: "100%", minHeight: 0 }}>
                      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                        <Typography.Text strong>后台快照</Typography.Text>
                        <Tag>审计备份</Tag>
                      </Space>
                      <div style={{ maxHeight: 520, overflowY: "auto", overscrollBehavior: "contain", paddingRight: 4 }}>
                      {snapshotHistoryQuery.isFetching && !snapshotHistory.length ? (
                        <Spin />
                      ) : snapshotHistory.length ? (
                        snapshotHistory.map((snapshot) => {
                          const action = getActionMeta(snapshot.action);
                          return (
                            <div
                              key={snapshot.id}
                              style={{
                                border: "1px solid var(--ant-color-border)",
                                borderRadius: 12,
                                padding: 10,
                                marginBottom: 10,
                                background: "var(--ant-color-bg-container)",
                              }}
                            >
                              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                                  <Tag color={action.color}>{action.label}</Tag>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>#{snapshot.id}</Typography.Text>
                                </Space>
                                <Typography.Text style={{ fontSize: 12 }}>{formatDateTime(snapshot.createdAt)}</Typography.Text>
                                <Typography.Text copyable={{ text: snapshot.contentSha256 }} code style={{ maxWidth: "100%" }}>
                                  {shortHash(snapshot.contentSha256)}
                                </Typography.Text>
                                <Space wrap size={4}>
                                  <Tag>{snapshot.type}</Tag>
                                  <Tag>{formatBytes(snapshot.contentLength)}</Tag>
                                  {snapshot.operatorEmail ? <Tag>{snapshot.operatorEmail}</Tag> : null}
                                </Space>
                                {snapshot.reason ? (
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    {snapshot.reason}
                                  </Typography.Text>
                                ) : null}
                                <Button
                                  size="small"
                                  icon={<RollbackOutlined />}
                                  onClick={() => void handleLoadSnapshot(snapshot)}
                                  loading={loadingSnapshotId === snapshot.id}
                                  disabled={!canWriteSelected}
                                  block
                                >
                                  载入快照
                                </Button>
                              </Space>
                            </div>
                          );
                        })
                      ) : (
                        <Empty description="暂无后台快照" />
                      )}
                      </div>
                    </Space>
                  </div>
                )}
              </Card>

              <Card title="危险操作">
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Alert type="warning" showIcon message="删除会移除 Nacos 配置" description="删除前请确认该配置不再被插件或后台任务依赖。" />
                  <Popconfirm
                    title="确认删除配置？"
                    description={`将删除 ${selected?.dataId || "当前配置"}，该操作不可直接撤销。`}
                    okText="确认删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => selected && deleteMutation.mutate({ dataId: selected.dataId, group: selected.group, tenant: selected.tenant, reason })}
                    disabled={!selected || !canWriteSelected}
                  >
                    <Button danger icon={<DeleteOutlined />} loading={deleteMutation.isPending} disabled={!selected || !canWriteSelected} block>
                      删除配置
                    </Button>
                  </Popconfirm>
                </Space>
              </Card>
            </Space>
          </div>
        </PageSection>
      </Space>

      <Modal
        title="新建 Nacos 配置"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateSubmit}
        confirmLoading={publishMutation.isPending}
        okText="创建/发布"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" initialValues={{ group: DEFAULT_GROUP, type: "json", content: "{}" }}>
          <Form.Item label="dataId" name="dataId" rules={[{ required: true, message: "请输入 dataId" }, { pattern: /^[a-zA-Z0-9_.:-]+$/, message: "只能包含字母、数字、_ . : -" }]}>
            <Input placeholder="例如 xhunt_new_config" />
          </Form.Item>
          <Form.Item label="group" name="group" rules={[{ required: true, message: "请输入 group" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="类型" name="type">
            <Select options={[{ label: "JSON", value: "json" }, { label: "Text", value: "text" }]} />
          </Form.Item>
          <Form.Item label="内容" name="content" rules={[{ required: true, message: "请输入配置内容" }]}>
            <TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
          </Form.Item>
          <Form.Item label="变更原因" name="reason">
            <Input placeholder="例如：创建新配置" maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </PermissionGuard>
  );
}
