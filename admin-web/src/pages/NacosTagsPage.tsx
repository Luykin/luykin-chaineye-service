import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";

const { Text } = Typography;

type TagLang = "zh" | "en";
type TagConfig = Record<string, string[]>;

const DATA_IDS: Record<TagLang, string> = {
  zh: "xhunt_built_in_tag",
  en: "xhunt_built_in_tag_en",
};

function cloneConfig(config: TagConfig): TagConfig {
  return JSON.parse(JSON.stringify(config)) as TagConfig;
}

function normalizeConfig(value: unknown): TagConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<TagConfig>((result, [handle, tags]) => {
    const normalizedHandle = String(handle || "").trim();
    if (!normalizedHandle) return result;

    result[normalizedHandle] = Array.isArray(tags)
      ? tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
      : [];
    return result;
  }, {});
}

function parseConfig(content?: string): TagConfig {
  if (!content) return {};
  return normalizeConfig(JSON.parse(content));
}

function sanitizeConfig(config: TagConfig): TagConfig {
  return Object.entries(config).reduce<TagConfig>((result, [handle, tags]) => {
    const normalizedHandle = handle.trim();
    if (!normalizedHandle) return result;
    result[normalizedHandle] = (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag ?? "").trim())
      .filter(Boolean);
    return result;
  }, {});
}

function stringifyConfig(config: TagConfig) {
  return JSON.stringify(sanitizeConfig(config), null, 2);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDiffHtml(originalConfig: TagConfig, config: TagConfig) {
  const oldJson = stringifyConfig(originalConfig || {});
  const newJson = stringifyConfig(config || {});

  if (!window.Diff?.createPatch) return escapeHtml(newJson);

  return window.Diff
    .createPatch("config.json", oldJson, newJson, "原始", "新")
    .split("\n")
    .slice(4)
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith("+")) return `<span class="ff-diff-added">${escaped}</span>`;
      if (line.startsWith("-")) return `<span class="ff-diff-removed">${escaped}</span>`;
      return escaped;
    })
    .join("\n");
}

function getDiffSummary(originalConfig: TagConfig, config: TagConfig) {
  const oldKeys = Object.keys(originalConfig || {});
  const newKeys = Object.keys(config || {});
  const added = newKeys.filter((key) => !oldKeys.includes(key)).length;
  const removed = oldKeys.filter((key) => !newKeys.includes(key)).length;
  const pieces = [];
  if (added) pieces.push(`+${added} handle`);
  if (removed) pieces.push(`-${removed} handle`);
  return pieces.length ? `（${pieces.join("，")}）` : stringifyConfig(originalConfig) === stringifyConfig(config) ? "（无变更）" : "（有变更）";
}

export function NacosTagsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [lang, setLang] = useState<TagLang>("zh");
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<TagConfig>({});
  const [originalConfig, setOriginalConfig] = useState<TagConfig>({});
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [handleValue, setHandleValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [diffHtml, setDiffHtml] = useState("");
  const [diffSummary, setDiffSummary] = useState("");

  const query = useQuery({
    queryKey: ["nacos-tags", lang],
    queryFn: () => fetchNacosConfig({ dataId: DATA_IDS[lang] }),
  });

  useEffect(() => {
    if (dirty) return;
    try {
      const parsed = parseConfig(query.data?.data.content || "{}");
      setConfig(parsed);
      setOriginalConfig(cloneConfig(parsed));
      setSelectedHandle((current) => (current && Object.prototype.hasOwnProperty.call(parsed, current) ? current : null));
      setHandleValue((current) => (current && Object.prototype.hasOwnProperty.call(parsed, current) ? current : ""));
    } catch (error) {
      setConfig({});
      setOriginalConfig({});
      setSelectedHandle(null);
      setHandleValue("");
      if (query.data?.data.content) {
        messageApi.error(error instanceof Error ? `标签配置解析失败：${error.message}` : "标签配置解析失败");
      }
    }
  }, [dirty, lang, messageApi, query.data?.data.content]);

  const hasChanges = dirty || stringifyConfig(config) !== stringifyConfig(originalConfig);
  const selectedTags = selectedHandle ? config[selectedHandle] || [] : [];

  const filteredEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return Object.entries(config)
      .filter(([handle]) => !keyword || handle.toLowerCase().includes(keyword))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [config, search]);

  const selectedPreview = useMemo(() => {
    if (!selectedHandle) return "";
    return JSON.stringify({ [selectedHandle]: selectedTags }, null, 2);
  }, [selectedHandle, selectedTags]);

  const publishMutation = useMutation({
    mutationFn: () =>
      publishNacosConfig({
        dataId: DATA_IDS[lang],
        content: JSON.stringify(sanitizeConfig(config)),
        source: "nacos-tags",
      }),
    onSuccess: () => {
      const nextOriginal = sanitizeConfig(config);
      setOriginalConfig(cloneConfig(nextOriginal));
      setConfig(nextOriginal);
      setDirty(false);
      setPreviewOpen(false);
      messageApi.success("标签配置已发布");
      void query.refetch();
    },
    onError: (error: Error) => {
      messageApi.error(error.message || "标签配置发布失败");
    },
  });

  function selectHandle(handle: string | null) {
    setSelectedHandle(handle);
    setHandleValue(handle || "");
  }

  function reload() {
    if (hasChanges && !window.confirm("当前有未发布修改，确认重新加载并丢弃修改吗？")) return;
    setDirty(false);
    void query.refetch();
  }

  function switchLang(nextLang: TagLang) {
    if (nextLang === lang) return;
    if (hasChanges && !window.confirm("当前有未发布修改，切换语言会丢弃修改，确认继续吗？")) return;
    setDirty(false);
    setSearch("");
    setConfig({});
    setOriginalConfig({});
    selectHandle(null);
    setLang(nextLang);
  }

  function addHandle() {
    let index = 1;
    let nextHandle = `_new_handle_${index}`;
    while (Object.prototype.hasOwnProperty.call(config, nextHandle)) {
      index += 1;
      nextHandle = `_new_handle_${index}`;
    }

    setConfig((current) => ({ ...current, [nextHandle]: [] }));
    selectHandle(nextHandle);
    setDirty(true);
  }

  function deleteSelectedHandle() {
    if (!selectedHandle) return;
    setConfig((current) => {
      const next = { ...current };
      delete next[selectedHandle];
      const nextSelected = Object.keys(next).sort((a, b) => a.localeCompare(b))[0] || null;
      selectHandle(nextSelected);
      return next;
    });
    setDirty(true);
    messageApi.success("已删除，记得点击发布");
  }

  function renameSelectedHandle(rawValue: string) {
    setHandleValue(rawValue);
    if (!selectedHandle) return;

    const nextHandle = rawValue.trim();
    if (!nextHandle || nextHandle === selectedHandle) return;

    if (Object.prototype.hasOwnProperty.call(config, nextHandle)) {
      return;
    }

    setConfig((current) => {
      const next = { ...current, [nextHandle]: current[selectedHandle] || [] };
      delete next[selectedHandle];
      return next;
    });
    setSelectedHandle(nextHandle);
    setDirty(true);
  }

  function restoreInvalidHandle() {
    const nextHandle = handleValue.trim();
    if (!selectedHandle) return;
    if (!nextHandle) {
      setHandleValue(selectedHandle);
      return;
    }
    if (nextHandle !== selectedHandle && Object.prototype.hasOwnProperty.call(config, nextHandle)) {
      messageApi.warning(`Handle "${nextHandle}" 已存在`);
      setHandleValue(selectedHandle);
    }
  }

  function updateTag(index: number, value: string) {
    if (!selectedHandle) return;
    setConfig((current) => {
      const tags = [...(current[selectedHandle] || [])];
      tags[index] = value;
      return { ...current, [selectedHandle]: tags };
    });
    setDirty(true);
  }

  function addTag() {
    if (!selectedHandle) return;
    setConfig((current) => ({ ...current, [selectedHandle]: [...(current[selectedHandle] || []), ""] }));
    setDirty(true);
  }

  function removeTag(index: number) {
    if (!selectedHandle) return;
    setConfig((current) => ({
      ...current,
      [selectedHandle]: (current[selectedHandle] || []).filter((_, tagIndex) => tagIndex !== index),
    }));
    setDirty(true);
  }

  function openPublishPreview() {
    if (!hasChanges) {
      messageApi.info("当前没有需要发布的修改");
      return;
    }
    setDiffHtml(buildDiffHtml(originalConfig, config));
    setDiffSummary(getDiffSummary(originalConfig, config));
    setPreviewOpen(true);
  }

  return (
    <PermissionGuard permission="nacos-tags">
      {contextHolder}
      <PageSection title="内置标签配置" description="可视化编辑 Nacos 配置：xhunt_built_in_tag / xhunt_built_in_tag_en。">
        <div className="nacos-tags-container">
          <div className="nacos-tags-toolbar">
            <div className="nacos-tags-toolbar-left">
              <Space.Compact>
                <Button type={lang === "zh" ? "primary" : "default"} onClick={() => switchLang("zh")}>中文</Button>
                <Button type={lang === "en" ? "primary" : "default"} onClick={() => switchLang("en")}>English</Button>
              </Space.Compact>
              <Text type="secondary">dataId: <Text code>{DATA_IDS[lang]}</Text></Text>
              <Text type="secondary">group: <Text code>DEFAULT_GROUP</Text></Text>
            </div>
            <Space wrap size={6}>
              <Button icon={<ReloadOutlined />} onClick={reload} loading={query.isFetching}>刷新</Button>
              <Button icon={<PlusOutlined />} onClick={addHandle}>新增 Handle</Button>
              <Popconfirm title={`确认删除 handle "${selectedHandle || ""}"？`} disabled={!selectedHandle} onConfirm={deleteSelectedHandle}>
                <Button danger icon={<DeleteOutlined />} disabled={!selectedHandle}>删除</Button>
              </Popconfirm>
              <Button type="primary" icon={<SendOutlined />} disabled={!hasChanges} loading={publishMutation.isPending} onClick={openPublishPreview}>发布</Button>
            </Space>
          </div>

          {query.isError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="加载标签配置失败" /> : null}

          <div className="nacos-tags-body">
            <section className="nacos-tags-panel nacos-tags-panel-list">
              <div className="nacos-tags-panel-header">
                <div className="nacos-tags-search">
                  <SearchOutlined />
                  <Input
                    variant="borderless"
                    size="small"
                    placeholder="搜索 handle..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <span className="nacos-tags-count">{filteredEntries.length}</span>
              </div>
              <div className="nacos-tags-list">
                {filteredEntries.length ? filteredEntries.map(([handle, tags]) => {
                  const tagList = Array.isArray(tags) ? tags : [];
                  const preview = tagList.slice(0, 3).join("、") + (tagList.length > 3 ? " ..." : "");
                  const active = handle === selectedHandle;
                  return (
                    <button
                      key={handle}
                      type="button"
                      className={active ? "nacos-tags-item is-active" : "nacos-tags-item"}
                      onClick={() => selectHandle(handle)}
                    >
                      <span className="nacos-tags-item-count">{tagList.length}</span>
                      <span className="nacos-tags-item-main">
                        <span className="nacos-tags-item-handle">{handle}</span>
                        <span className="nacos-tags-item-preview">{preview || "无标签"}</span>
                      </span>
                    </button>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据，点击「新增 Handle」创建" />}
              </div>
            </section>

            <section className="nacos-tags-panel nacos-tags-panel-editor">
              <div className="nacos-tags-panel-header">
                <span>编辑标签</span>
                <span className="nacos-tags-editor-hint">
                  {selectedHandle ? `正在编辑: ${selectedHandle}` : "选择左侧 handle 开始编辑"}
                </span>
              </div>

              {!selectedHandle ? (
                <div className="nacos-tags-editor-empty">
                  <div className="nacos-tags-empty-title">请选择一个 Handle</div>
                  <div className="nacos-tags-empty-desc">从左侧列表选择，或点击「新增 Handle」创建</div>
                </div>
              ) : (
                <div className="nacos-tags-editor-body">
                  <div className="nacos-tags-field-row">
                    <label>Handle（推特账号，不带 @）</label>
                    <Input
                      value={handleValue}
                      placeholder="例如：anishagnihotri"
                      onChange={(event) => renameSelectedHandle(event.target.value)}
                      onBlur={restoreInvalidHandle}
                      onPressEnter={restoreInvalidHandle}
                    />
                  </div>

                  <div className="nacos-tags-field-row">
                    <label>标签列表</label>
                    <div className="nacos-tags-list-editor">
                      {selectedTags.length ? selectedTags.map((tag, index) => (
                        <div className="nacos-tags-input-row" key={`${selectedHandle}-${index}`}>
                          <Input
                            value={tag}
                            placeholder="输入标签内容..."
                            onChange={(event) => updateTag(index, event.target.value)}
                          />
                          <Button danger onClick={() => removeTag(index)}>删除</Button>
                        </div>
                      )) : <div className="nacos-tags-tag-empty">暂无标签，点击下方按钮添加</div>}
                    </div>
                    <Button size="small" onClick={addTag}>+ 添加标签</Button>
                  </div>

                  <div className="nacos-tags-preview-section">
                    <div className="nacos-tags-preview-header">JSON 预览</div>
                    <pre className="nacos-tags-preview-pre">{selectedPreview}</pre>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </PageSection>

      <Modal
        title="预览 JSON 配置"
        open={previewOpen}
        width={900}
        confirmLoading={publishMutation.isPending}
        okText="确认发布"
        cancelText="取消"
        onCancel={() => setPreviewOpen(false)}
        onOk={() => publishMutation.mutate()}
      >
        <p className="nacos-tags-preview-legend">
          即将发布到 Nacos（dataId: <Text code>{DATA_IDS[lang]}</Text>）
          <span className="nacos-tags-diff-summary">{diffSummary}</span>
          <span className="nacos-tags-legend-removed">删除</span> | <span className="nacos-tags-legend-added">新增</span>
        </p>
        <pre className="ff-diff-output" dangerouslySetInnerHTML={{ __html: diffHtml }} />
      </Modal>
    </PermissionGuard>
  );
}
