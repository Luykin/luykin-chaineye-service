import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";

type MessageLang = "zh" | "en";

interface MessageItem {
  title?: string;
  type?: string;
  content?: string;
  created?: number | string;
  [key: string]: unknown;
}

const DATA_IDS: Record<MessageLang, string> = {
  zh: "xhunt_message",
  en: "xhunt_message_en",
};

const DEFAULT_FOOTER_HTML = "<br>请加入我们的<a href='https://t.me/xhunt_ai' target='_blank' style='color:rgb(29, 155, 240)'>电报群</a>获取最新资讯。";

function parseMessageItems(content?: string): MessageItem[] {
  if (!content) return [];
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

function cloneItems(items: MessageItem[]) {
  return JSON.parse(JSON.stringify(items)) as MessageItem[];
}

function stripHtml(content?: string) {
  if (!content) return "";
  return content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatCreated(value?: number | string) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || !ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDiffHtml(oldItems: MessageItem[], newItems: MessageItem[]) {
  const oldText = JSON.stringify(oldItems || [], null, 2);
  const newText = JSON.stringify(newItems || [], null, 2);
  if (window.Diff?.createPatch) {
    const patch = window.Diff.createPatch("config.json", oldText, newText, "原始", "新");
    return patch
      .split("\n")
      .slice(4)
      .map((line: string) => {
        const escaped = escapeHtml(line);
        if (line.startsWith("+")) return `<span class="ff-diff-added">${escaped}</span>`;
        if (line.startsWith("-")) return `<span class="ff-diff-removed">${escaped}</span>`;
        return escaped;
      })
      .join("\n");
  }
  return escapeHtml(newText);
}

export function NacosMessagesPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [lang, setLang] = useState<MessageLang>("zh");
  const [items, setItems] = useState<MessageItem[]>([]);
  const [originalItems, setOriginalItems] = useState<MessageItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [diffHtml, setDiffHtml] = useState("");

  const query = useQuery({
    queryKey: ["nacos-messages", lang],
    queryFn: () => fetchNacosConfig({ dataId: DATA_IDS[lang] }),
  });

  useEffect(() => {
    if (!query.data?.data.content || dirty) return;
    try {
      const parsed = parseMessageItems(query.data.data.content);
      setItems(parsed);
      setOriginalItems(cloneItems(parsed));
      setSelectedIndex(parsed.length ? 0 : -1);
    } catch {
      setItems([]);
      setOriginalItems([]);
      setSelectedIndex(-1);
    }
  }, [query.data?.data.content, dirty]);

  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;
  const hasChanges = dirty || JSON.stringify(items) !== JSON.stringify(originalItems);

  const publishMutation = useMutation({
    mutationFn: () =>
      publishNacosConfig({
        dataId: DATA_IDS[lang],
        content: JSON.stringify(items, null, 2),
        source: "nacos-messages",
      }),
    onSuccess: () => {
      messageApi.success("公告配置已发布");
      setOriginalItems(cloneItems(items));
      setDirty(false);
      setPreviewOpen(false);
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "公告配置发布失败");
    },
  });

  function reload() {
    if (hasChanges && !window.confirm("当前有未发布修改，确认重新加载并丢弃修改吗？")) return;
    setDirty(false);
    void query.refetch();
  }

  function switchLang(nextLang: MessageLang) {
    if (hasChanges && !window.confirm("当前有未发布修改，切换语言会丢弃修改，确认继续吗？")) return;
    setDirty(false);
    setItems([]);
    setOriginalItems([]);
    setSelectedIndex(-1);
    setLang(nextLang);
  }

  function updateSelected(patch: Partial<MessageItem>) {
    if (selectedIndex < 0) return;
    setItems((current) => current.map((item, index) => (index === selectedIndex ? { ...item, ...patch } : item)));
    setDirty(true);
  }

  function addItem() {
    const next: MessageItem = {
      created: Date.now(),
      title: "",
      type: "all",
      content: DEFAULT_FOOTER_HTML,
    };
    setItems((current) => [next, ...current]);
    setSelectedIndex(0);
    setDirty(true);
  }

  function deleteSelected() {
    if (selectedIndex < 0) return;
    setItems((current) => current.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(-1);
    setDirty(true);
  }

  function openPublishPreview() {
    if (!hasChanges) {
      messageApi.info("当前没有需要发布的修改");
      return;
    }
    setDiffHtml(buildDiffHtml(originalItems, items));
    setPreviewOpen(true);
  }

  const listTitle = useMemo(() => `${items.length} 条`, [items.length]);

  return (
    <PermissionGuard permission="nacos-messages">
      {contextHolder}
      <PageSection title="公告配置" description="可视化编辑 Nacos 配置：xhunt_message / xhunt_message_en。">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" styles={{ body: { padding: 12 } }}>
            <div className="nacos-legacy-toolbar">
              <div className="nacos-legacy-toolbar-left">
                <Space.Compact>
                  <Button type={lang === "zh" ? "primary" : "default"} onClick={() => switchLang("zh")}>中文</Button>
                  <Button type={lang === "en" ? "primary" : "default"} onClick={() => switchLang("en")}>English</Button>
                </Space.Compact>
                <Typography.Text type="secondary">dataId: <Typography.Text code>{DATA_IDS[lang]}</Typography.Text></Typography.Text>
              </div>
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={reload} loading={query.isFetching}>重新加载</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={addItem}>新增公告</Button>
                <Popconfirm title="确认删除当前公告？" disabled={!selectedItem} onConfirm={deleteSelected}>
                  <Button danger icon={<DeleteOutlined />} disabled={!selectedItem}>删除</Button>
                </Popconfirm>
                <Button type="primary" icon={<SendOutlined />} disabled={!hasChanges} onClick={openPublishPreview}>发布</Button>
              </Space>
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8} xl={7}>
              <Card size="small" title="公告列表" extra={<Tag>{listTitle}</Tag>} styles={{ body: { padding: 0 } }}>
                <div style={{ maxHeight: 620, overflow: "auto" }}>
                  {items.length ? (
                    <List
                      dataSource={items}
                      renderItem={(item, index) => {
                        const active = index === selectedIndex;
                        return (
                          <List.Item
                            key={`${item.created || index}-${index}`}
                            onClick={() => setSelectedIndex(index)}
                            className={active ? "nacos-list-item is-active" : "nacos-list-item"}
                          >
                            <Space direction="vertical" size={4} style={{ width: "100%" }}>
                              <Space wrap>
                                <Typography.Text strong>{item.title || `公告 ${index + 1}`}</Typography.Text>
                                <Tag>{item.type || "all"}</Tag>
                              </Space>
                              <Typography.Text type="secondary" ellipsis>{stripHtml(item.content) || "无内容"}</Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatCreated(item.created)}</Typography.Text>
                            </Space>
                          </List.Item>
                        );
                      }}
                    />
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告，点击「新增公告」创建" style={{ padding: 24 }} />
                  )}
                </div>
              </Card>
            </Col>

            <Col xs={24} lg={16} xl={17}>
              <Card size="small" title="编辑器" extra={<Typography.Text type="secondary">{selectedItem ? "正在编辑公告" : "选择左侧公告开始编辑"}</Typography.Text>}>
                {selectedItem ? (
                  <Space direction="vertical" size={14} style={{ width: "100%" }}>
                    <div className="nacos-editor-field">
                      <Typography.Text strong>标题</Typography.Text>
                      <Input value={String(selectedItem.title || "")} onChange={(event) => updateSelected({ title: event.target.value })} placeholder="请输入公告标题" />
                    </div>
                    <div className="nacos-editor-field">
                      <Typography.Text strong>类型</Typography.Text>
                      <Select
                        value={String(selectedItem.type || "all")}
                        onChange={(value) => updateSelected({ type: value })}
                        options={[{ value: "all", label: "全部" }, { value: "web3", label: "Web3" }, { value: "ai", label: "AI" }]}
                        style={{ width: 180 }}
                      />
                    </div>
                    <Alert
                      type="warning"
                      showIcon
                      message="颜色提示"
                      description="粘贴富文本后建议清理固定颜色，确保公告在白天/黑夜模式下都可读。"
                    />
                    <div className="nacos-editor-field">
                      <Typography.Text strong>内容</Typography.Text>
                      <Input.TextArea
                        value={String(selectedItem.content || "")}
                        onChange={(event) => updateSelected({ content: event.target.value })}
                        rows={10}
                        placeholder="请输入公告内容（支持 HTML）"
                      />
                    </div>
                    <Card size="small" title="实时预览">
                      <div className="nacos-message-preview" dangerouslySetInnerHTML={{ __html: String(selectedItem.content || "") }} />
                    </Card>
                    <Alert type="info" showIcon message="发布到 Nacos 会覆盖当前语言的整个公告数组。建议每条公告使用时间戳（毫秒）作为 created 字段。" />
                  </Space>
                ) : (
                  <Empty description="请选择一个公告" />
                )}
              </Card>
            </Col>
          </Row>

          {query.isError ? <Alert type="error" showIcon message="加载公告配置失败" /> : null}
        </Space>

        <Modal
          open={previewOpen}
          width={820}
          title="预览 JSON 配置"
          okText="确认发布"
          cancelText="取消"
          confirmLoading={publishMutation.isPending}
          onOk={() => publishMutation.mutate()}
          onCancel={() => setPreviewOpen(false)}
        >
          <Typography.Paragraph type="secondary">即将发布到 Nacos：<Typography.Text code>{DATA_IDS[lang]}</Typography.Text></Typography.Paragraph>
          <pre className="ff-diff-output" dangerouslySetInnerHTML={{ __html: diffHtml }} />
        </Modal>
      </PageSection>
    </PermissionGuard>
  );
}
