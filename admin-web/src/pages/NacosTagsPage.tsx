import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";

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

  return Object.entries(value as Record<string, unknown>).reduce<TagConfig>(
    (result, [handle, tags]) => {
      const normalizedHandle = String(handle || "").trim();
      if (!normalizedHandle) return result;

      result[normalizedHandle] = Array.isArray(tags)
        ? tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
        : [];
      return result;
    },
    {},
  );
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

  return window.Diff.createPatch("config.json", oldJson, newJson, "原始", "新")
    .split("\n")
    .slice(4)
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith("+"))
        return `<span class="ff-diff-added">${escaped}</span>`;
      if (line.startsWith("-"))
        return `<span class="ff-diff-removed">${escaped}</span>`;
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
  return pieces.length
    ? `（${pieces.join("，")}）`
    : stringifyConfig(originalConfig) === stringifyConfig(config)
      ? "（无变更）"
      : "（有变更）";
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
      setSelectedHandle((current) =>
        current && Object.prototype.hasOwnProperty.call(parsed, current)
          ? current
          : null,
      );
      setHandleValue((current) =>
        current && Object.prototype.hasOwnProperty.call(parsed, current)
          ? current
          : "",
      );
    } catch (error) {
      setConfig({});
      setOriginalConfig({});
      setSelectedHandle(null);
      setHandleValue("");
      if (query.data?.data.content) {
        messageApi.error(
          error instanceof Error
            ? `标签配置解析失败：${error.message}`
            : "标签配置解析失败",
        );
      }
    }
  }, [dirty, lang, messageApi, query.data?.data.content]);

  const hasChanges =
    dirty || stringifyConfig(config) !== stringifyConfig(originalConfig);
  const selectedTags = selectedHandle ? config[selectedHandle] || [] : [];
  const totalHandles = Object.keys(config).length;
  const totalTags = Object.values(config).reduce(
    (sum, tags) =>
      sum + (Array.isArray(tags) ? tags.filter(Boolean).length : 0),
    0,
  );

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
    if (
      hasChanges &&
      !window.confirm("当前有未发布修改，确认重新加载并丢弃修改吗？")
    )
      return;
    setDirty(false);
    void query.refetch();
  }

  function switchLang(nextLang: TagLang) {
    if (nextLang === lang) return;
    if (
      hasChanges &&
      !window.confirm("当前有未发布修改，切换语言会丢弃修改，确认继续吗？")
    )
      return;
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
      const nextSelected =
        Object.keys(next).sort((a, b) => a.localeCompare(b))[0] || null;
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
    if (
      nextHandle !== selectedHandle &&
      Object.prototype.hasOwnProperty.call(config, nextHandle)
    ) {
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
    setConfig((current) => ({
      ...current,
      [selectedHandle]: [...(current[selectedHandle] || []), ""],
    }));
    setDirty(true);
  }

  function removeTag(index: number) {
    if (!selectedHandle) return;
    setConfig((current) => ({
      ...current,
      [selectedHandle]: (current[selectedHandle] || []).filter(
        (_, tagIndex) => tagIndex !== index,
      ),
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
      <ConfigWorkbench
        className="nacos-tags-container"
        title="内置标签配置"
        description="维护用户 handle 与内置标签映射，发布到 Nacos 后插件侧生效。"
        meta={
          <Tag
            color={hasChanges ? "orange" : "green"}
            className="nacos-tags-status-tag"
          >
            {hasChanges ? "有未发布修改" : "已同步"}
          </Tag>
        }
        toolbar={
          <>
            <div className="nacos-tags-toolbar-left">
              <Segmented
                size="small"
                value={lang}
                options={[
                  { label: "中文", value: "zh" },
                  { label: "English", value: "en" },
                ]}
                onChange={(value) => switchLang(value as TagLang)}
              />
            </div>
            <Space wrap size={6}>
              <Button
                icon={<ReloadOutlined />}
                onClick={reload}
                loading={query.isFetching}
              >
                刷新
              </Button>
              <Button icon={<PlusOutlined />} onClick={addHandle}>
                新增 Handle
              </Button>
              <Popconfirm
                title={`确认删除 handle "${selectedHandle || ""}"？`}
                disabled={!selectedHandle}
                onConfirm={deleteSelectedHandle}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!selectedHandle}
                >
                  删除
                </Button>
              </Popconfirm>
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={!hasChanges}
                loading={publishMutation.isPending}
                onClick={openPublishPreview}
              >
                发布
              </Button>
            </Space>
          </>
        }
        sidebarTitle={<span>Handle 列表</span>}
        sidebarMeta={`${filteredEntries.length}/${totalHandles}`}
        sidebar={
          <>
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
            <div className="nacos-tags-list config-workbench-list">
              {filteredEntries.length ? (
                filteredEntries.map(([handle, tags]) => {
                  const tagList = Array.isArray(tags) ? tags : [];
                  const previewTags = tagList.slice(0, 3);
                  const active = handle === selectedHandle;
                  return (
                    <button
                      key={handle}
                      type="button"
                      className={
                        active
                          ? "config-workbench-list-item nacos-tags-item is-active active"
                          : "config-workbench-list-item nacos-tags-item"
                      }
                      onClick={() => selectHandle(handle)}
                    >
                      <span className="nacos-tags-item-count">
                        {tagList.length}
                      </span>
                      <span className="nacos-tags-item-main">
                        <span className="nacos-tags-item-handle">{handle}</span>
                        <span className="nacos-tags-item-preview">
                          {previewTags.length
                            ? previewTags.map((item) => (
                                <span
                                  className="nacos-tags-mini-chip"
                                  key={`${handle}-${item}`}
                                >
                                  {item}
                                </span>
                              ))
                            : "无标签"}
                          {tagList.length > 3 ? (
                            <span className="nacos-tags-more-chip">
                              +{tagList.length - 3}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无数据，点击「新增 Handle」创建"
                />
              )}
            </div>
          </>
        }
        editorTitle="编辑标签"
        editorMeta={
          selectedHandle
            ? `${selectedTags.length} 个标签`
            : "选择左侧 handle 开始编辑"
        }
      >
        {query.isError ? (
          <Alert
            style={{ marginBottom: 12 }}
            type="error"
            showIcon
            message="加载标签配置失败"
          />
        ) : null}

        <div className="nacos-tags-stats">
          <div className="nacos-tags-stat-card">
            <span>Handle 总数</span>
            <strong>{totalHandles}</strong>
          </div>
          <div className="nacos-tags-stat-card">
            <span>标签总数</span>
            <strong>{totalTags}</strong>
          </div>
          <div className="nacos-tags-stat-card">
            <span>当前语言</span>
            <strong>{lang === "zh" ? "中文" : "EN"}</strong>
          </div>
        </div>

        {!selectedHandle ? (
          <div className="nacos-tags-editor-empty editor-empty">
            <div className="nacos-tags-empty-title empty-title">
              请选择一个 Handle
            </div>
            <div className="nacos-tags-empty-desc empty-desc">
              从左侧列表选择，或点击「新增 Handle」创建
            </div>
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
                {selectedTags.length ? (
                  selectedTags.map((tag, index) => (
                    <div
                      className="nacos-tags-input-row"
                      key={`${selectedHandle}-${index}`}
                    >
                      <span className="nacos-tags-input-index">
                        {index + 1}
                      </span>
                      <Input
                        value={tag}
                        placeholder="输入标签内容..."
                        onChange={(event) =>
                          updateTag(index, event.target.value)
                        }
                      />
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeTag(index)}
                      />
                    </div>
                  ))
                ) : (
                  <div className="nacos-tags-tag-empty">
                    暂无标签，点击下方按钮添加
                  </div>
                )}
              </div>
              <Button
                className="nacos-tags-add-tag-btn"
                size="small"
                icon={<PlusOutlined />}
                onClick={addTag}
              >
                添加标签
              </Button>
            </div>

            <div className="nacos-tags-chip-preview-section">
              <div className="nacos-tags-preview-header">标签效果预览</div>
              <div className="nacos-tags-chip-preview">
                {selectedTags.filter(Boolean).length ? (
                  selectedTags.filter(Boolean).map((tag, index) => (
                    <span
                      className="nacos-tags-preview-chip"
                      key={`${tag}-${index}`}
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="nacos-tags-preview-empty-text">
                    暂无可预览标签
                  </span>
                )}
              </div>
            </div>

            <div className="nacos-tags-preview-section">
              <div className="nacos-tags-preview-header">JSON 预览</div>
              <pre className="nacos-tags-preview-pre">{selectedPreview}</pre>
            </div>
          </div>
        )}
      </ConfigWorkbench>

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
          即将发布到 Nacos
          <span className="nacos-tags-diff-summary">{diffSummary}</span>
          <span className="nacos-tags-legend-removed">删除</span> |{" "}
          <span className="nacos-tags-legend-added">新增</span>
        </p>
        <pre
          className="ff-diff-output"
          dangerouslySetInnerHTML={{ __html: diffHtml }}
        />
      </Modal>
    </PermissionGuard>
  );
}
