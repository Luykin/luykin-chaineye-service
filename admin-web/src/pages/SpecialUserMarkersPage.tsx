import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
  SyncOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  GlobalOutlined,
  LockOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import {
  fetchSpecialMarkers,
  upsertSpecialMarker,
  batchImportSpecialMarkers,
  toggleSpecialMarker,
  deleteSpecialMarker,
  resolveTwitterId,
  syncTwitterIds,
} from "@/services/specialMarkers";
import type {
  SpecialMarkerItem,
  MarkerColorPreset,
  MarkerVariant,
  MarkerIcon,
  MarkerEffect,
  MarkerVisibleScope,
} from "@/types/specialMarkers";

const { Text } = Typography;

// 预设色系定义与配置
const COLOR_PRESET_OPTIONS: { label: string; value: MarkerColorPreset; hex: string; bgLight: string; textLight: string }[] = [
  { label: "警示红 (高危/诈骗)", value: "danger-red", hex: "#dc2626", bgLight: "#fee2e2", textLight: "#dc2626" },
  { label: "风险橙 (可疑/搬运)", value: "warning-orange", hex: "#ea580c", bgLight: "#ffedd5", textLight: "#ea580c" },
  { label: "认证蓝 (官方/合作)", value: "info-blue", hex: "#2563eb", bgLight: "#dbeafe", textLight: "#2563eb" },
  { label: "安全绿 (合规/核验)", value: "success-green", hex: "#16a34a", bgLight: "#dcfce7", textLight: "#16a34a" },
  { label: "尊享紫 (顾问/核心)", value: "purple-special", hex: "#9333ea", bgLight: "#f3e8ff", textLight: "#9333ea" },
  { label: "黄金金 (创办/VIP)", value: "gold-amber", hex: "#d97706", bgLight: "#fef3c7", textLight: "#b45309" },
  { label: "中性灰 (注销/存档)", value: "neutral-gray", hex: "#4b5563", bgLight: "#f3f4f6", textLight: "#4b5563" },
];

const VARIANT_OPTIONS: { label: string; value: MarkerVariant; desc: string }[] = [
  { label: "柔和药丸 (Subtle)", value: "subtle", desc: "半透明底色 + 彩色文字，自然融入推特" },
  { label: "实色醒目 (Solid)", value: "solid", desc: "高饱和实底 + 白字，强提示" },
  { label: "线框镂空 (Outline)", value: "outline", desc: "透明底 + 彩色线框，利落精致" },
  { label: "微光发光 (Glow)", value: "glow", desc: "微霓虹外发光投影，极度抓眼" },
];

const ICON_OPTIONS: { label: string; value: MarkerIcon; emoji: string }[] = [
  { label: "无图标 (纯文字)", value: "none", emoji: "" },
  { label: "警示盾牌 (shield-alert)", value: "shield-alert", emoji: "🛡️" },
  { label: "警告三角 (alert-triangle)", value: "alert-triangle", emoji: "⚠️" },
  { label: "安全盾牌 (shield-check)", value: "shield-check", emoji: "🛡️" },
  { label: "认证打勾 (badge-check)", value: "badge-check", emoji: "✓" },
  { label: "危险骷髅 (skull)", value: "skull", emoji: "☠️" },
  { label: "热点火苗 (flame)", value: "flame", emoji: "🔥" },
  { label: "尊贵皇冠 (crown)", value: "crown", emoji: "👑" },
  { label: "机器人 (bot)", value: "bot", emoji: "🤖" },
  { label: "禁止符号 (ban)", value: "ban", emoji: "🚫" },
  { label: "闪电先锋 (zap)", value: "zap", emoji: "⚡" },
];

const EFFECT_OPTIONS: { label: string; value: MarkerEffect }[] = [
  { label: "静态无动画", value: "none" },
  { label: "呼吸脉冲 (Pulse - 适合极度高危)", value: "pulse" },
];

/**
 * 微型徽章预览组件（模拟 X 网页端样式）
 */
function MarkerPreviewBadge({
  text,
  colorPreset,
  variant,
  icon,
  effect,
}: {
  text: string;
  colorPreset: MarkerColorPreset;
  variant: MarkerVariant;
  icon: MarkerIcon;
  effect: MarkerEffect;
}) {
  const currentPreset = COLOR_PRESET_OPTIONS.find((c) => c.value === colorPreset) || COLOR_PRESET_OPTIONS[0];

  let style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    fontSize: "11px",
    lineHeight: 1,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: "4px",
    userSelect: "none",
    verticalAlign: "middle",
  };

  if (variant === "solid") {
    style = {
      ...style,
      backgroundColor: currentPreset.hex,
      color: "#ffffff",
      border: "1px solid transparent",
    };
  } else if (variant === "outline") {
    style = {
      ...style,
      backgroundColor: "transparent",
      color: currentPreset.textLight,
      border: `1px solid ${currentPreset.hex}`,
    };
  } else if (variant === "glow") {
    style = {
      ...style,
      backgroundColor: currentPreset.bgLight,
      color: currentPreset.textLight,
      border: `1px solid ${currentPreset.hex}`,
      boxShadow: `0 0 6px ${currentPreset.hex}66`,
    };
  } else {
    // subtle
    style = {
      ...style,
      backgroundColor: currentPreset.bgLight,
      color: currentPreset.textLight,
      border: `1px solid ${currentPreset.hex}40`,
    };
  }

  const iconItem = ICON_OPTIONS.find((i) => i.value === icon);

  return (
    <span style={style} className={effect === "pulse" ? "xhunt-pulse-preview" : ""}>
      {iconItem?.emoji && <span style={{ fontSize: "10px" }}>{iconItem.emoji}</span>}
      <span>{text || "标记文本"}</span>
    </span>
  );
}

export function SpecialUserMarkersPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [colorPreset, setColorPreset] = useState("all");
  const [visibleScope, setVisibleScope] = useState("all");
  const [enabledStatus, setEnabledStatus] = useState("all");

  // 关键字防抖，避免每次按键都触发请求
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SpecialMarkerItem | null>(null);

  const [editForm] = Form.useForm();
  const [batchForm] = Form.useForm();

  // 监听编辑表单的动态值用于实时预览
  const formText = Form.useWatch("markerText", editForm) || editingItem?.markerText || "疑似诈骗";
  const formColor = Form.useWatch("colorPreset", editForm) || editingItem?.colorPreset || "danger-red";
  const formVariant = Form.useWatch("variant", editForm) || editingItem?.variant || "subtle";
  const formIcon = Form.useWatch("icon", editForm) || editingItem?.icon || "none";
  const formEffect = Form.useWatch("effect", editForm) || editingItem?.effect || "none";
  const formVisibleScope = Form.useWatch("visibleScope", editForm) || editingItem?.visibleScope || "all";
  const batchVisibleScope = Form.useWatch("visibleScope", batchForm) || "all";

  // 快捷反查 handle -> twid
  const [quickHandleInput, setQuickHandleInput] = useState("");
  const [resolvingTwid, setResolvingTwid] = useState(false);

  // 列表数据加载
  const query = useQuery({
    queryKey: ["special-markers-list", debouncedKeyword, colorPreset, visibleScope, enabledStatus],
    queryFn: () =>
      fetchSpecialMarkers({
        keyword: debouncedKeyword,
        colorPreset,
        visibleScope,
        enabled: enabledStatus,
      }),
  });

  const items = query.data?.data || [];

  // 统计指标
  const stats = useMemo(() => {
    let scamCount = 0;
    let safeCount = 0;
    let publicCount = 0;
    let whitelistCount = 0;
    let missingTwidCount = 0;
    let enabledCount = 0;

    for (const item of items) {
      if (item.enabled) enabledCount++;
      if (item.colorPreset === "danger-red") scamCount++;
      if (item.colorPreset === "info-blue" || item.colorPreset === "success-green") safeCount++;
      if (item.visibleScope === "whitelist") whitelistCount++;
      else publicCount++;
      if (!item.twitterId) missingTwidCount++;
    }

    return {
      total: items.length,
      enabledCount,
      scamCount,
      safeCount,
      publicCount,
      whitelistCount,
      missingTwidCount,
    };
  }, [items]);

  // Mutations
  const upsertMutation = useMutation({
    mutationFn: upsertSpecialMarker,
    onSuccess: () => {
      messageApi.success("保存成功并已刷新缓存");
      setEditModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["special-markers-list"] });
    },
    onError: (err: any) => {
      messageApi.error(err.message || "保存失败");
    },
  });

  const batchMutation = useMutation({
    mutationFn: batchImportSpecialMarkers,
    onSuccess: (res) => {
      messageApi.success(`成功导入 ${res.data.count} 个账号标记并刷新缓存`);
      setBatchModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["special-markers-list"] });
    },
    onError: (err: any) => {
      messageApi.error(err.message || "批量导入失败");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: toggleSpecialMarker,
    onSuccess: (res) => {
      messageApi.success(`已${res.data.enabled ? "启用" : "停用"}标记 @${res.data.username}`);
      queryClient.invalidateQueries({ queryKey: ["special-markers-list"] });
    },
    onError: (err: any) => {
      messageApi.error(err.message || "操作失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSpecialMarker,
    onSuccess: () => {
      messageApi.success("标记已删除");
      queryClient.invalidateQueries({ queryKey: ["special-markers-list"] });
    },
    onError: (err: any) => {
      messageApi.error(err.message || "删除失败");
    },
  });

  const syncTwidMutation = useMutation({
    mutationFn: syncTwitterIds,
    onSuccess: (res) => {
      messageApi.success(`已自动补齐 ${res.data.synced} 个账号的 Twitter ID`);
      queryClient.invalidateQueries({ queryKey: ["special-markers-list"] });
    },
    onError: (err: any) => {
      messageApi.error(err.message || "同步失败");
    },
  });

  // 打开新增弹窗
  const handleOpenAddModal = () => {
    setEditingItem(null);
    editForm.resetFields();
    editForm.setFieldsValue({
      colorPreset: "danger-red",
      variant: "subtle",
      icon: "shield-alert",
      effect: "none",
      visibleScope: "all",
      visibleTwidsStr: "",
      enabled: true,
    });
    setEditModalOpen(true);
  };

  // 打开编辑弹窗
  const handleOpenEditModal = (item: SpecialMarkerItem) => {
    setEditingItem(item);
    editForm.resetFields();
    editForm.setFieldsValue({
      username: item.username,
      twitterId: item.twitterId || "",
      markerText: item.markerText,
      colorPreset: item.colorPreset,
      variant: item.variant,
      icon: item.icon,
      effect: item.effect,
      description: item.description || "",
      linkUrl: item.linkUrl || "",
      visibleScope: item.visibleScope,
      visibleTwidsStr: (item.visibleTwids || []).join("\n"),
      enabled: item.enabled,
    });
    setEditModalOpen(true);
  };

  // 快捷反查当前表单目标 handle 的 twid
  const handleResolveTargetTwid = async () => {
    const u = editForm.getFieldValue("username");
    if (!u) {
      messageApi.warning("请先输入目标 Twitter handle");
      return;
    }
    setResolvingTwid(true);
    try {
      const res = await resolveTwitterId(u);
      if (res.success && res.data?.twid) {
        editForm.setFieldsValue({ twitterId: res.data.twid });
        messageApi.success(`查询成功: ${res.data.twid}`);
      } else {
        messageApi.error(res.error || "未查找到 Twitter ID");
      }
    } catch (e: any) {
      messageApi.error(e.message || "反查失败");
    } finally {
      setResolvingTwid(false);
    }
  };

  // 快捷将白名单 handle 转为 twid 追加进文本框
  const handleAddWhitelistHandle = async () => {
    if (!quickHandleInput.trim()) return;
    setResolvingTwid(true);
    try {
      const res = await resolveTwitterId(quickHandleInput.trim());
      if (res.success && res.data?.twid) {
        const currentStr = editForm.getFieldValue("visibleTwidsStr") || "";
        const parts = currentStr.split(/[\r\n,;\s]+/).map((s: string) => s.trim()).filter(Boolean);
        if (!parts.includes(res.data.twid)) {
          parts.push(res.data.twid);
        }
        editForm.setFieldsValue({ visibleTwidsStr: parts.join("\n") });
        messageApi.success(`已添加 @${quickHandleInput} (${res.data.twid}) 到白名单`);
        setQuickHandleInput("");
      } else {
        messageApi.error(res.error || "未查找到该用户 Twitter ID");
      }
    } catch (e: any) {
      messageApi.error(e.message || "查询失败");
    } finally {
      setResolvingTwid(false);
    }
  };

  // 提交编辑表单
  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields();
      const rawTwids = String(values.visibleTwidsStr || "").split(/[\r\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

      upsertMutation.mutate({
        username: values.username,
        twitterId: values.twitterId || null,
        markerText: values.markerText,
        colorPreset: values.colorPreset,
        variant: values.variant,
        icon: values.icon,
        effect: values.effect,
        description: values.description || null,
        linkUrl: values.linkUrl || null,
        visibleScope: values.visibleScope,
        visibleTwids: rawTwids,
        enabled: values.enabled,
      });
    } catch (_) {}
  };

  // 提交批量导入表单
  const handleSaveBatch = async () => {
    try {
      const values = await batchForm.validateFields();
      const rawTwids = String(values.visibleTwidsStr || "").split(/[\r\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

      batchMutation.mutate({
        usernames: values.usernames,
        markerText: values.markerText,
        colorPreset: values.colorPreset,
        variant: values.variant,
        icon: values.icon,
        effect: values.effect,
        description: values.description || undefined,
        linkUrl: values.linkUrl || undefined,
        visibleScope: values.visibleScope,
        visibleTwids: rawTwids,
        enabled: values.enabled,
      });
    } catch (_) {}
  };

  // 表格列定义
  const columns: ColumnsType<SpecialMarkerItem> = [
    {
      title: "目标 Handler",
      dataIndex: "username",
      key: "username",
      width: 200,
      render: (username: string, record) => (
        <div>
          <Text strong copyable={{ text: `@${username}` }}>
            @{username}
          </Text>
          <div style={{ fontSize: "11px", color: "#8c8c8c" }}>
            {record.twitterId ? `ID: ${record.twitterId}` : <span style={{ color: "#faad14" }}>未同步 Twitter ID</span>}
          </div>
        </div>
      ),
    },
    {
      title: "微型徽章与皮肤预览",
      key: "markerPreview",
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <MarkerPreviewBadge
            text={record.markerText}
            colorPreset={record.colorPreset}
            variant={record.variant}
            icon={record.icon}
            effect={record.effect}
          />
          <div style={{ fontSize: "11px", color: "#8c8c8c" }}>
            {record.variant} · {record.icon !== "none" ? record.icon : "纯文字"}
            {record.effect === "pulse" ? " · 呼吸动效" : ""}
          </div>
        </Space>
      ),
    },
    {
      title: "可见性范围",
      dataIndex: "visibleScope",
      key: "visibleScope",
      width: 170,
      render: (scope: MarkerVisibleScope, record) => {
        if (scope === "whitelist") {
          const count = (record.visibleTwids || []).length;
          return (
            <Tooltip
              title={
                <div>
                  <div>允许可见的 Twitter ID ({count}个):</div>
                  <div style={{ maxHeight: 150, overflowY: "auto", fontSize: "11px" }}>
                    {(record.visibleTwids || []).map((id) => (
                      <div key={id}>{id}</div>
                    ))}
                  </div>
                </div>
              }
            >
              <Tag icon={<LockOutlined />} color="orange">
                白名单 ({count} 人)
              </Tag>
            </Tooltip>
          );
        }
        return (
          <Tag icon={<GlobalOutlined />} color="blue">
            全员可见
          </Tag>
        );
      },
    },
    {
      title: "标记说明 / 证据",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (desc: string | null, record) => (
        <div>
          {desc ? (
            <Tooltip title={desc}>
              <Text style={{ maxWidth: 220 }} ellipsis>
                {desc}
              </Text>
            </Tooltip>
          ) : (
            <Text type="secondary">-</Text>
          )}
          {record.linkUrl && (
            <div>
              <a href={record.linkUrl} target="_blank" rel="noreferrer" style={{ fontSize: "11px" }}>
                佐证链接 ↗
              </a>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "启用状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 100,
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          loading={toggleMutation.isPending && (toggleMutation.variables as any) === record.id}
          onChange={() => toggleMutation.mutate(record.id)}
        />
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 160,
      render: (time: string) => <span style={{ fontSize: "12px", color: "#8c8c8c" }}>{new Date(time).toLocaleString()}</span>,
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_, record) => (
        <Space size={8}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleOpenEditModal(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该标记？"
            description={`删除后 @${record.username} 上的特殊标记将失效。`}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PermissionGuard permission="special-markers">
      {contextHolder}
      <div style={{ padding: "20px 24px" }}>
        {/* 标题与统计区 */}
        <PageSection
          title="Twitter 账号特殊标记配置"
          description="配置指定 Twitter Handler 的专属标记（如“疑似诈骗”、“官方认证”等），支持丰富视觉皮肤、动效与请求头 twid 白名单可见性控制。"
          extra={
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAddModal}>
                新增标记
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setBatchModalOpen(true)}>
                批量导入
              </Button>
              <Button icon={<SyncOutlined />} onClick={() => syncTwidMutation.mutate()} loading={syncTwidMutation.isPending}>
                补齐 Twitter ID
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>
                刷新
              </Button>
            </Space>
          }
        >
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="全部标记数" value={stats.total} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="生效启用中" value={stats.enabledCount} valueStyle={{ color: "#3f8600" }} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="疑似诈骗/高危" value={stats.scamCount} valueStyle={{ color: "#cf1322" }} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="官方/安全认证" value={stats.safeCount} valueStyle={{ color: "#1890ff" }} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="白名单仅可见" value={stats.whitelistCount} valueStyle={{ color: "#fa8c16" }} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="未同步 TwitterId" value={stats.missingTwidCount} valueStyle={{ color: "#faad14" }} />
              </Card>
            </Col>
          </Row>

          {/* 筛选过滤工具栏 */}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[12, 12]} align="middle">
              <Col xs={24} sm={8} md={6}>
                <Input
                  placeholder="搜索 Handler / 标记文字 / ID..."
                  prefix={<SearchOutlined />}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  allowClear
                />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Select
                  style={{ width: "100%" }}
                  value={colorPreset}
                  onChange={setColorPreset}
                  options={[
                    { label: "全部色系", value: "all" },
                    ...COLOR_PRESET_OPTIONS.map((c) => ({ label: c.label, value: c.value })),
                  ]}
                />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Select
                  style={{ width: "100%" }}
                  value={visibleScope}
                  onChange={setVisibleScope}
                  options={[
                    { label: "全部可见范围", value: "all" },
                    { label: "全员公开可见", value: "public" },
                    { label: "仅白名单用户可见", value: "whitelist" },
                  ]}
                />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Select
                  style={{ width: "100%" }}
                  value={enabledStatus}
                  onChange={setEnabledStatus}
                  options={[
                    { label: "全部状态", value: "all" },
                    { label: "已启用", value: "true" },
                    { label: "已停用", value: "false" },
                  ]}
                />
              </Col>
            </Row>
          </Card>

          {/* 表格 */}
          <Table
            columns={columns}
            dataSource={items}
            rowKey="id"
            loading={query.isLoading}
            pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          />
        </PageSection>

        {/* 新增 / 编辑 Modal */}
        <Modal
          title={editingItem ? `编辑特殊标记: @${editingItem.username}` : "新增特殊标记"}
          open={editModalOpen}
          onOk={handleSaveEdit}
          onCancel={() => setEditModalOpen(false)}
          confirmLoading={upsertMutation.isPending}
          width={720}
          destroyOnClose
        >
          <Form form={editForm} layout="vertical" initialValues={{ enabled: true, colorPreset: "danger-red", visibleScope: "all" }}>
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item
                  name="username"
                  label="目标 Twitter Handler"
                  rules={[{ required: true, message: "请输入 Twitter handle" }]}
                  tooltip="目标账号的用户名，例如 elonmusk 或 scammer123（可不带@）"
                >
                  <Input placeholder="例如: scammer_boss" addonBefore="@" disabled={Boolean(editingItem)} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item
                  name="twitterId"
                  label="Twitter 数字 ID (选填)"
                  tooltip="Twitter 分配的全局数字 ID，用于改名后持续追踪"
                >
                  <Input
                    placeholder="可自动查询"
                    suffix={
                      <Button
                        type="link"
                        size="small"
                        onClick={handleResolveTargetTwid}
                        loading={resolvingTwid}
                      >
                        反查ID
                      </Button>
                    }
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="markerText"
                  label="标记文本"
                  rules={[{ required: true, message: "请输入标记文本" }]}
                  tooltip="显示在名字后的小标记文字，建议 2~6 个汉字"
                >
                  <Input placeholder="例如: 疑似诈骗 / 官方合作 / 搬运账号" maxLength={12} showCount />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="colorPreset" label="视觉色系预设" rules={[{ required: true }]}>
                  <Select
                    options={COLOR_PRESET_OPTIONS.map((c) => ({
                      label: (
                        <Space>
                          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: c.hex }} />
                          {c.label}
                        </Space>
                      ),
                      value: c.value,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* 丰富视觉皮肤体系 */}
            <Card
              size="small"
              title="皮肤与表现形态 (Rich Visual Skin)"
              style={{ marginBottom: 16, background: "#fafafa" }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="variant" label="徽章形态" rules={[{ required: true }]}>
                    <Select options={VARIANT_OPTIONS.map((v) => ({ label: v.label, value: v.value }))} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="icon" label="微型图标" rules={[{ required: true }]}>
                    <Select options={ICON_OPTIONS.map((i) => ({ label: `${i.emoji} ${i.label}`, value: i.value }))} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="effect" label="动效特效" rules={[{ required: true }]}>
                    <Select options={EFFECT_OPTIONS.map((e) => ({ label: e.label, value: e.value }))} />
                  </Form.Item>
                </Col>
              </Row>

              {/* 实时推特名字模拟预览卡片 */}
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  border: "1px dashed #d9d9d9",
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "11px", color: "#8c8c8c", marginBottom: 4 }}>推特网页端实时渲染预览:</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "14px", fontWeight: 700 }}>
                    <span>Target Name</span>
                    <span style={{ fontSize: "12px", color: "#536471", fontWeight: 400 }}>
                      @{editForm.getFieldValue("username") || "handler"}
                    </span>
                    <MarkerPreviewBadge
                      text={formText}
                      colorPreset={formColor}
                      variant={formVariant}
                      icon={formIcon}
                      effect={formEffect}
                    />
                  </div>
                </div>
                <Tag color="cyan">见即所得</Tag>
              </div>
            </Card>

            {/* 可见性范围控制 */}
            <Card size="small" title="可见性范围权限控制 (Visibility Scope)" style={{ marginBottom: 16 }}>
              <Form.Item name="visibleScope" style={{ marginBottom: 12 }}>
                <Radio.Group>
                  <Radio value="all">
                    <Space direction="vertical" size={0}>
                      <span style={{ fontWeight: 600 }}>全部人可见 (Public)</span>
                      <span style={{ fontSize: "12px", color: "#8c8c8c" }}>全网所有安装插件的用户均能在推特上看到该标记</span>
                    </Space>
                  </Radio>
                  <Radio value="whitelist" style={{ marginTop: 10 }}>
                    <Space direction="vertical" size={0}>
                      <span style={{ fontWeight: 600 }}>指定白名单用户可见 (Whitelist by header twid)</span>
                      <span style={{ fontSize: "12px", color: "#8c8c8c" }}>仅指定的 Twitter ID 用户在使用插件时可见（适合内部预审与灰度测试）</span>
                    </Space>
                  </Radio>
                </Radio.Group>
              </Form.Item>

              {formVisibleScope === "whitelist" && (
                <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 4, padding: "12px 14px", marginTop: 8 }}>
                  <Form.Item
                    name="visibleTwidsStr"
                    label="允许查看的 Twitter ID 列表 (一行一个或逗号分隔)"
                    rules={[{ required: true, message: "白名单模式下必须至少指定一个 Twitter ID" }]}
                    tooltip="后端通过请求头 x-tw-id 进行比对判定"
                  >
                    <Input.TextArea rows={3} placeholder="例如:&#10;1570682472358346752&#10;1300679567988801536" />
                  </Form.Item>

                  <Space align="center">
                    <span style={{ fontSize: "12px" }}>快速转换添加:</span>
                    <Input
                      size="small"
                      placeholder="输入 handle, 如 @admin_x"
                      value={quickHandleInput}
                      onChange={(e) => setQuickHandleInput(e.target.value)}
                      style={{ width: 180 }}
                    />
                    <Button size="small" onClick={handleAddWhitelistHandle} loading={resolvingTwid}>
                      转换为 ID 并添加
                    </Button>
                  </Space>
                </div>
              )}
            </Card>

            <Form.Item name="description" label="标记说明 / 证据备注 (Tooltip 展示)">
              <Input.TextArea rows={2} placeholder="例如：多位用户反馈在私聊中假冒客服索要助记词（用户鼠标 Hover 时将在插件端展示）" />
            </Form.Item>

            <Form.Item name="linkUrl" label="详情/佐证链接 (选填)">
              <Input placeholder="https://..." />
            </Form.Item>

            <Form.Item name="enabled" label="立即启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Modal>

        {/* 批量导入 Modal */}
        <Modal
          title="批量导入特殊标记"
          open={batchModalOpen}
          onOk={handleSaveBatch}
          onCancel={() => setBatchModalOpen(false)}
          confirmLoading={batchMutation.isPending}
          width={640}
          destroyOnClose
        >
          <Form form={batchForm} layout="vertical" initialValues={{ colorPreset: "danger-red", variant: "subtle", icon: "shield-alert", effect: "none", visibleScope: "all", enabled: true }}>
            <Form.Item
              name="usernames"
              label="目标 Twitter Handles 列表 (支持换行/逗号/分号分隔)"
              rules={[{ required: true, message: "请输入至少一个 Twitter handle" }]}
            >
              <Input.TextArea rows={4} placeholder="例如:&#10;scammer_a&#10;scammer_b&#10;fraud_master" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="markerText" label="标记文本" rules={[{ required: true, message: "请输入标记文本" }]}>
                  <Input placeholder="例如: 疑似诈骗" maxLength={12} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="colorPreset" label="视觉色系">
                  <Select options={COLOR_PRESET_OPTIONS.map((c) => ({ label: c.label, value: c.value }))} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="variant" label="形态">
                  <Select options={VARIANT_OPTIONS.map((v) => ({ label: v.label, value: v.value }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="icon" label="图标">
                  <Select options={ICON_OPTIONS.map((i) => ({ label: `${i.emoji} ${i.label}`, value: i.value }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="effect" label="动效">
                  <Select options={EFFECT_OPTIONS.map((e) => ({ label: e.label, value: e.value }))} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="visibleScope" label="可见范围">
              <Radio.Group>
                <Radio value="all">全员公开可见</Radio>
                <Radio value="whitelist">指定白名单可见</Radio>
              </Radio.Group>
            </Form.Item>

            {batchVisibleScope === "whitelist" && (
              <Form.Item
                name="visibleTwidsStr"
                label="允许查看的 Twitter ID 列表 (一行一个或逗号分隔)"
                rules={[{ required: true, message: "白名单模式下必须至少指定一个 Twitter ID" }]}
                tooltip="后端通过请求头 x-tw-id 进行比对判定"
              >
                <Input.TextArea rows={3} placeholder="例如:&#10;1570682472358346752&#10;1300679567988801536" />
              </Form.Item>
            )}

            <Form.Item name="description" label="统一标记原因 / 说明">
              <Input placeholder="批量导入原因，如：2026-09 安全团队通报钓鱼名单" />
            </Form.Item>

            <Form.Item name="enabled" label="立即启用" valuePropName="checked">
              <Switch defaultChecked />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </PermissionGuard>
  );
}
