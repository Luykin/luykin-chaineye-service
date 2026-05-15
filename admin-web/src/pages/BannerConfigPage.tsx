import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { AdminImageUpload } from "@/components/upload/AdminImageUpload";
import { fetchFeatureFlagsConfig, publishFeatureFlagsConfig } from "@/services/feature-flags";
import type { AdBannerConfig, FeatureFlagsConfig } from "@/types/feature-flags";

const BANNER_IMAGE_MAX_MB = 3;
const DEFAULT_BANNER_TYPE = "commercial";

const BANNER_TYPE_OPTIONS = [
  { label: "商业投放", value: "commercial" },
  { label: "活动推广", value: "campaign" },
  { label: "站内运营", value: "operation" },
  { label: "其他", value: "custom" },
];

function parseConfig(content?: string): FeatureFlagsConfig {
  if (!content) return {};
  const parsed = JSON.parse(content) as FeatureFlagsConfig;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBanners(value: unknown): AdBannerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item, index) => ({
      id: String(item.id || `banner_${index + 1}`),
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      type: String(item.type || DEFAULT_BANNER_TYPE),
      daily_limit: Number.isFinite(Number(item.daily_limit)) ? Number(item.daily_limit) : 1,
      visible_to: Array.isArray(item.visible_to) ? item.visible_to.map(String).filter(Boolean) : [],
      image_url_zh: String(item.image_url_zh || ""),
      link_url_zh: String(item.link_url_zh || ""),
      alt_text_zh: String(item.alt_text_zh || ""),
      image_url_en: String(item.image_url_en || ""),
      link_url_en: String(item.link_url_en || ""),
      alt_text_en: String(item.alt_text_en || ""),
    }));
}

function normalizeTags(values?: string[]) {
  return Array.from(new Set((values || []).map((item) => item.trim()).filter(Boolean)));
}

function createEmptyBanner(existing: AdBannerConfig[]): AdBannerConfig {
  const nextIndex = existing.length + 1;
  return {
    id: `banner_${Date.now().toString(36)}_${nextIndex}`,
    enabled: true,
    type: DEFAULT_BANNER_TYPE,
    daily_limit: 1,
    visible_to: [],
    image_url_zh: "",
    link_url_zh: "",
    alt_text_zh: "",
    image_url_en: "",
    link_url_en: "",
    alt_text_en: "",
  };
}

function toPublishBanners(banners: AdBannerConfig[]) {
  return banners.map((item) => ({
    id: item.id.trim(),
    enabled: !!item.enabled,
    type: item.type || DEFAULT_BANNER_TYPE,
    daily_limit: Number(item.daily_limit || 0),
    visible_to: normalizeTags(item.visible_to),
    image_url_zh: item.image_url_zh?.trim() || "",
    link_url_zh: item.link_url_zh?.trim() || "",
    alt_text_zh: item.alt_text_zh?.trim() || "",
    image_url_en: item.image_url_en?.trim() || "",
    link_url_en: item.link_url_en?.trim() || "",
    alt_text_en: item.alt_text_en?.trim() || "",
  }));
}

function BannerPreview({ banner }: { banner: AdBannerConfig }) {
  const zhImage = banner.image_url_zh || banner.image_url_en;
  const enImage = banner.image_url_en || banner.image_url_zh;
  return (
    <div className="banner-preview-stack">
      <div className="banner-preview-panel">
        <span className="banner-preview-label">中文</span>
        {zhImage ? <Image src={zhImage} alt={banner.alt_text_zh || banner.id} preview={false} /> : <div className="banner-preview-empty">未配置图片</div>}
      </div>
      <div className="banner-preview-panel">
        <span className="banner-preview-label">English</span>
        {enImage ? <Image src={enImage} alt={banner.alt_text_en || banner.id} preview={false} /> : <div className="banner-preview-empty">No image</div>}
      </div>
    </div>
  );
}

export function BannerConfigPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [banners, setBanners] = useState<AdBannerConfig[]>([]);
  const [dirty, setDirty] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form] = Form.useForm<AdBannerConfig>();

  const configQuery = useQuery({
    queryKey: ["banner-config", "xhunt_config"],
    queryFn: fetchFeatureFlagsConfig,
    select: (data) => parseConfig(data.data.content),
  });

  useEffect(() => {
    if (!configQuery.data || dirty) return;
    setBanners(normalizeBanners(configQuery.data.adBanners));
  }, [configQuery.data, dirty]);

  const enabledCount = banners.filter((item) => item.enabled).length;
  const targetedCount = banners.filter((item) => item.visible_to.length).length;

  const publishMutation = useMutation({
    mutationFn: async (nextBanners: AdBannerConfig[]) => {
      const latest = parseConfig((await fetchFeatureFlagsConfig()).data.content);
      const nextConfig = cloneConfig(latest);
      nextConfig.adBanners = toPublishBanners(nextBanners);
      return publishFeatureFlagsConfig(JSON.stringify(nextConfig, null, 2));
    },
    onSuccess: async () => {
      messageApi.success("Banner 配置已发布");
      setDirty(false);
      await configQuery.refetch();
    },
    onError: (error) => messageApi.error(error instanceof Error ? error.message : "发布失败"),
  });

  const sortedBanners = useMemo(() => banners.map((item, index) => ({ ...item, _index: index })), [banners]);

  function markBanners(next: AdBannerConfig[]) {
    setBanners(next);
    setDirty(true);
  }

  async function reloadConfig() {
    if (dirty && !window.confirm("当前有未发布改动，确定丢弃并重新加载线上配置吗？")) return;
    const result = await configQuery.refetch();
    if (result.data) {
      setBanners(normalizeBanners(result.data.adBanners));
      setDirty(false);
      messageApi.success("已重新加载线上配置");
    }
  }

  function openCreate() {
    setEditingIndex(null);
    form.setFieldsValue(createEmptyBanner(banners));
    setDrawerOpen(true);
  }

  function openEdit(index: number) {
    setEditingIndex(index);
    form.setFieldsValue(cloneConfig(banners[index]));
    setDrawerOpen(true);
  }

  async function saveDrawer() {
    const values = await form.validateFields();
    const nextBanner = toPublishBanners([values])[0];
    const duplicated = banners.some((item, index) => item.id === nextBanner.id && index !== editingIndex);
    if (duplicated) {
      messageApi.error("Banner ID 已存在，请换一个唯一 ID");
      return;
    }
    const next = [...banners];
    if (editingIndex === null) next.push(nextBanner);
    else next[editingIndex] = nextBanner;
    markBanners(next);
    setDrawerOpen(false);
    messageApi.success(editingIndex === null ? "已添加，记得发布生效" : "已更新，记得发布生效");
  }

  function duplicateBanner(index: number) {
    const source = banners[index];
    const copied = {
      ...cloneConfig(source),
      id: `${source.id}_copy_${Date.now().toString(36)}`,
      enabled: false,
    };
    markBanners([...banners.slice(0, index + 1), copied, ...banners.slice(index + 1)]);
  }

  function deleteBanner(index: number) {
    markBanners(banners.filter((_, itemIndex) => itemIndex !== index));
  }

  function toggleBanner(index: number, enabled: boolean) {
    const next = cloneConfig(banners);
    next[index].enabled = enabled;
    markBanners(next);
  }

  function moveBanner(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= banners.length) return;
    const next = cloneConfig(banners);
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    markBanners(next);
  }

  const columns: ColumnsType<AdBannerConfig & { _index: number }> = [
    {
      title: "Banner",
      dataIndex: "id",
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Typography.Text strong copyable>{row.id}</Typography.Text>
            <Tag color={row.enabled ? "green" : "default"}>{row.enabled ? "启用" : "停用"}</Tag>
            <Tag color="blue">{BANNER_TYPE_OPTIONS.find((item) => item.value === row.type)?.label || row.type}</Tag>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            每日上限 {row.daily_limit || 0} 次 · {row.visible_to.length ? `定向 ${row.visible_to.length} 人` : "全量可见"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "预览",
      width: 360,
      render: (_, row) => <BannerPreview banner={row} />,
    },
    {
      title: "中文链接",
      dataIndex: "link_url_zh",
      ellipsis: true,
      render: (value: string) => value ? <Typography.Link href={value} target="_blank" rel="noreferrer" ellipsis>{value}</Typography.Link> : <Typography.Text type="secondary">未配置</Typography.Text>,
    },
    {
      title: "英文链接",
      dataIndex: "link_url_en",
      ellipsis: true,
      render: (value: string) => value ? <Typography.Link href={value} target="_blank" rel="noreferrer" ellipsis>{value}</Typography.Link> : <Typography.Text type="secondary">未配置</Typography.Text>,
    },
    {
      title: "操作",
      width: 210,
      fixed: "right",
      render: (_, row) => (
        <Space size={4} wrap>
          <Switch size="small" checked={row.enabled} onChange={(checked) => toggleBanner(row._index, checked)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row._index)}>编辑</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => duplicateBanner(row._index)}>复制</Button>
          <Button size="small" disabled={row._index === 0} onClick={() => moveBanner(row._index, -1)}>上移</Button>
          <Button size="small" disabled={row._index === banners.length - 1} onClick={() => moveBanner(row._index, 1)}>下移</Button>
          <Popconfirm title="删除这个 Banner？" okText="删除" cancelText="取消" onConfirm={() => deleteBanner(row._index)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PermissionGuard permission="banner-config">
      {contextHolder}
      <PageSection
        title="Banner 配置"
        description="运营维护 xhunt_config.adBanners。图片建议先压缩后上传，单张限制 3MB。"
        extra={
          <Space wrap>
            {dirty ? <Tag color="orange">未发布</Tag> : <Tag color="green">已同步</Tag>}
            <Button icon={<ReloadOutlined />} onClick={() => void reloadConfig()} loading={configQuery.isFetching}>刷新</Button>
            <Button icon={<PlusOutlined />} onClick={openCreate}>新增 Banner</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={publishMutation.isPending} disabled={!dirty} onClick={() => publishMutation.mutate(banners)}>发布</Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          className="banner-config-alert"
          message="上传前请先压缩图片"
          description={`这一页只修改 xhunt_config 的 adBanners 字段，不会覆盖 Feature Flags 的其他配置。图片上传走 Vercel Blob，单张最大 ${BANNER_IMAGE_MAX_MB}MB，推荐 webp/png。`}
        />

        <Row gutter={[12, 12]} className="banner-config-summary">
          <Col xs={24} md={8}>
            <Card size="small"><Typography.Text type="secondary">Banner 总数</Typography.Text><strong>{banners.length}</strong></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Typography.Text type="secondary">启用中</Typography.Text><strong>{enabledCount}</strong></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Typography.Text type="secondary">定向投放</Typography.Text><strong>{targetedCount}</strong></Card>
          </Col>
        </Row>

        <Table
          rowKey="id"
          size="small"
          className="banner-config-table"
          columns={columns}
          dataSource={sortedBanners}
          loading={configQuery.isFetching}
          pagination={false}
          scroll={{ x: 1280 }}
          locale={{ emptyText: <Empty description="暂无 Banner，点击右上角新增" /> }}
        />
      </PageSection>

      <Drawer
        title={editingIndex === null ? "新增 Banner" : "编辑 Banner"}
        open={drawerOpen}
        width={720}
        destroyOnHidden
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { paddingBottom: 88 } }}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={() => void saveDrawer()}>保存草稿</Button></Space>}
      >
        <Form form={form} layout="vertical" requiredMark={false} initialValues={createEmptyBanner(banners)}>
          <Card size="small" title="基础信息" className="banner-form-card">
            <Row gutter={12}>
              <Col xs={24} md={14}>
                <Form.Item name="id" label="Banner ID" rules={[{ required: true, message: "请输入唯一 ID" }, { pattern: /^[a-zA-Z0-9_-]+$/, message: "仅支持字母、数字、下划线和中划线" }]}>
                  <Input placeholder="predict_2" />
                </Form.Item>
              </Col>
              <Col xs={12} md={5}>
                <Form.Item name="enabled" label="状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
              </Col>
              <Col xs={12} md={5}>
                <Form.Item name="daily_limit" label="每日展示上限" rules={[{ required: true, message: "请输入上限" }]}>
                  <InputNumber min={0} max={99} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="type" label="类型">
              <Select options={BANNER_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="visible_to" label="定向用户" tooltip="留空表示全量可见。输入 Twitter handle 后回车，支持粘贴逗号分隔。">
              <Select mode="tags" tokenSeparators={[",", " ", "\n"]} placeholder="例如 LuykinAI, xhunt_ai" maxTagCount="responsive" />
            </Form.Item>
          </Card>

          <Card size="small" title="中文 Banner" className="banner-form-card">
            <Form.Item name="image_url_zh" label="中文图片" rules={[{ required: true, message: "请上传或填写中文图片 URL" }]}>
              <AdminImageUpload purpose="banner-image" directory="admin-images/banners" maxSizeMb={BANNER_IMAGE_MAX_MB} />
            </Form.Item>
            <Form.Item name="link_url_zh" label="中文跳转链接" rules={[{ required: true, message: "请输入中文跳转链接" }, { type: "url", message: "请输入完整 URL" }]}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item name="alt_text_zh" label="中文替代文案">
              <Input placeholder="用于图片加载失败或辅助阅读" />
            </Form.Item>
          </Card>

          <Card size="small" title="英文 Banner" className="banner-form-card">
            <Form.Item name="image_url_en" label="英文图片" rules={[{ required: true, message: "请上传或填写英文图片 URL" }]}>
              <AdminImageUpload purpose="banner-image" directory="admin-images/banners" maxSizeMb={BANNER_IMAGE_MAX_MB} />
            </Form.Item>
            <Form.Item name="link_url_en" label="英文跳转链接" rules={[{ required: true, message: "请输入英文跳转链接" }, { type: "url", message: "请输入完整 URL" }]}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item name="alt_text_en" label="英文替代文案">
              <Input placeholder="Accessible alt text" />
            </Form.Item>
          </Card>
        </Form>
      </Drawer>
    </PermissionGuard>
  );
}
