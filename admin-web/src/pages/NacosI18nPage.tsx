import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Popconfirm,
  Space,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";

const { TextArea } = Input;

const DATA_ID = "xhunt_i18n";
const GROUP = "DEFAULT_GROUP";
const DISPLAY_NAMESPACE = "public";
const DEFAULT_LANGS = ["zh", "en"];

type I18nConfig = Record<string, Record<string, string>>;

function stableStringify(value: I18nConfig) {
  const sortedLangs = Object.keys(value).sort();
  const normalized: I18nConfig = {};
  sortedLangs.forEach((lang) => {
    normalized[lang] = {};
    Object.keys(value[lang] || {}).sort().forEach((key) => {
      normalized[lang][key] = value[lang][key] ?? "";
    });
  });
  return JSON.stringify(normalized, null, 2);
}

function toText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function parseI18nContent(content: string): I18nConfig {
  const parsed = JSON.parse(content || "{}");
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const next: I18nConfig = {};

  Object.entries(source).forEach(([lang, langValue]) => {
    if (!langValue || typeof langValue !== "object" || Array.isArray(langValue)) return;
    next[lang] = {};
    Object.entries(langValue as Record<string, unknown>).forEach(([key, value]) => {
      next[lang][key] = toText(value);
    });
  });

  DEFAULT_LANGS.forEach((lang) => {
    if (!next[lang]) next[lang] = {};
  });

  return next;
}

function getAllKeys(config: I18nConfig) {
  const keys = new Set<string>();
  Object.values(config).forEach((langMap) => {
    Object.keys(langMap || {}).forEach((key) => keys.add(key));
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function cloneConfig(config: I18nConfig): I18nConfig {
  return JSON.parse(JSON.stringify(config || {})) as I18nConfig;
}

function buildPublishContent(config: I18nConfig) {
  const next: I18nConfig = {};
  Object.keys(config).sort().forEach((lang) => {
    next[lang] = {};
    Object.keys(config[lang] || {}).sort().forEach((key) => {
      next[lang][key] = config[lang][key] ?? "";
    });
  });
  return JSON.stringify(next, null, 2);
}

export function NacosI18nPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<I18nConfig>(() => parseI18nContent("{}"));
  const [baseline, setBaseline] = useState<I18nConfig>(() => parseI18nContent("{}"));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["nacos-i18n", DATA_ID, GROUP],
    queryFn: () => fetchNacosConfig({ dataId: DATA_ID, group: GROUP }),
  });

  const dirty = stableStringify(config) !== stableStringify(baseline);
  const langs = useMemo(() => {
    const names = Object.keys(config).filter(Boolean).sort();
    DEFAULT_LANGS.forEach((lang) => {
      if (!names.includes(lang)) names.push(lang);
    });
    return names;
  }, [config]);
  const allKeys = useMemo(() => getAllKeys(config), [config]);

  useEffect(() => {
    if (query.data?.data?.content == null || dirty) return;
    try {
      const next = parseI18nContent(query.data.data.content);
      setConfig(next);
      setBaseline(cloneConfig(next));
      const keys = getAllKeys(next);
      setSelectedKey((current) => current && keys.includes(current) ? current : keys[0] || null);
    } catch {
      // 渲染区会展示错误提示；这里不覆盖本地状态，避免误删已有草稿。
    }
  }, [dirty, query.data]);

  const parseError = useMemo(() => {
    if (query.data?.data?.content == null) return null;
    try {
      parseI18nContent(query.data.data.content);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "JSON 解析失败";
    }
  }, [query.data]);

  const filteredKeys = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return allKeys;
    return allKeys.filter((key) => {
      if (key.toLowerCase().includes(keyword)) return true;
      return langs.some((lang) => String(config[lang]?.[key] || "").toLowerCase().includes(keyword));
    });
  }, [allKeys, config, langs, search]);

  const selectedValues = selectedKey
    ? Object.fromEntries(langs.map((lang) => [lang, config[lang]?.[selectedKey] || ""]))
    : {};
  const missingCount = allKeys.reduce((sum, key) => {
    return sum + langs.filter((lang) => !(config[lang]?.[key] || "").trim()).length;
  }, 0);

  function ensureCanDiscard() {
    return !dirty || window.confirm("当前有未保存修改，确认丢弃这些修改吗？");
  }

  function reload() {
    if (!ensureCanDiscard()) return;
    setSelectedKey(null);
    void query.refetch();
  }

  function addKey() {
    const raw = window.prompt("请输入新的翻译 key（例如 settings）");
    const key = String(raw || "").trim();
    if (!key) return;
    if (allKeys.includes(key)) {
      messageApi.warning("这个 key 已存在");
      setSelectedKey(key);
      return;
    }
    setConfig((current) => {
      const next = cloneConfig(current);
      langs.forEach((lang) => {
        next[lang] = next[lang] || {};
        next[lang][key] = "";
      });
      return next;
    });
    setSelectedKey(key);
  }

  function deleteKey(key: string) {
    setConfig((current) => {
      const next = cloneConfig(current);
      Object.keys(next).forEach((lang) => {
        delete next[lang][key];
      });
      return next;
    });
    const nextKey = filteredKeys.find((item) => item !== key) || null;
    setSelectedKey(nextKey);
  }

  function updateValue(lang: string, key: string, value: string) {
    setConfig((current) => {
      const next = cloneConfig(current);
      next[lang] = next[lang] || {};
      next[lang][key] = value;
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: () => publishNacosConfig({
      dataId: DATA_ID,
      group: GROUP,
      content: buildPublishContent(config),
      type: "json",
      source: "nacos-i18n",
    }),
    onSuccess: () => {
      const nextBaseline = cloneConfig(config);
      setBaseline(nextBaseline);
      messageApi.success("翻译配置已发布到 Nacos");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "发布失败"),
  });

  return (
    <PermissionGuard permission="nacos_config">
      {contextHolder}
      <ConfigWorkbench
        className="nacos-i18n-container"
        title="翻译配置"
        description={`Namespace: ${DISPLAY_NAMESPACE} / Data ID: ${DATA_ID} / Group: ${GROUP}`}
        meta={<Tag color={dirty ? "orange" : "green"}>{dirty ? "有未保存修改" : "已同步"}</Tag>}
        toolbar={
          <Space wrap size={6}>
            <Button icon={<ReloadOutlined />} onClick={reload} loading={query.isFetching}>刷新</Button>
            <Button icon={<PlusOutlined />} onClick={addKey}>添加 key</Button>
            <Popconfirm title={`确认删除 ${selectedKey || "当前 key"}？`} disabled={!selectedKey} onConfirm={() => selectedKey && deleteKey(selectedKey)}>
              <Button danger icon={<DeleteOutlined />} disabled={!selectedKey}>删除</Button>
            </Popconfirm>
            <Button type="primary" icon={<SaveOutlined />} disabled={!dirty || !!parseError} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>发布到 Nacos</Button>
          </Space>
        }
        sidebarTitle="翻译 key"
        sidebarMeta={`${filteredKeys.length}/${allKeys.length}`}
        sidebar={
          <>
            <div className="nacos-tags-search nacos-i18n-search">
              <SearchOutlined />
              <Input variant="borderless" size="small" placeholder="搜索 key / 翻译内容..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="nacos-tags-list config-workbench-list">
              {filteredKeys.length ? filteredKeys.map((key) => {
                const active = key === selectedKey;
                const zh = config.zh?.[key] || "";
                const en = config.en?.[key] || "";
                return (
                  <button key={key} type="button" className={active ? "config-workbench-list-item nacos-tags-item is-active active" : "config-workbench-list-item nacos-tags-item"} onClick={() => setSelectedKey(key)}>
                    <span className="nacos-tags-item-count">K</span>
                    <span className="nacos-tags-item-main">
                      <span className="nacos-tags-item-handle">{key}</span>
                      <span className="nacos-tags-item-preview">
                        <span className="nacos-tags-mini-chip">zh: {zh || "未配置"}</span>
                        <span className="nacos-tags-mini-chip">en: {en || "未配置"}</span>
                      </span>
                    </span>
                  </button>
                );
              }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的翻译 key" />}
            </div>
          </>
        }
        editorTitle={selectedKey || "选择一个翻译 key"}
        editorMeta={selectedKey ? `${langs.length} 个语言字段` : "可搜索、添加、删除 key"}
      >
        {query.isError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="加载 Nacos 翻译配置失败" /> : null}
        {parseError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="Nacos 内容不是合法的翻译 JSON" description={parseError} /> : null}

        <div className="nacos-tags-stats nacos-i18n-stats">
          <div className="nacos-tags-stat-card"><span>Key 总数</span><strong>{allKeys.length}</strong></div>
          <div className="nacos-tags-stat-card"><span>语言</span><strong>{langs.join(" / ")}</strong></div>
          <div className="nacos-tags-stat-card"><span>空翻译</span><strong>{missingCount}</strong></div>
        </div>

        {selectedKey ? (
          <div className="nacos-tags-editor-body nacos-i18n-editor-body">
            <div className="nacos-i18n-key-card">
              <label>Translation Key</label>
              <Input value={selectedKey} readOnly />
              <span>重命名请先添加新 key，再删除旧 key，避免误改调用方引用。</span>
            </div>

            <div className="nacos-i18n-lang-grid">
              {langs.map((lang) => (
                <div className="nacos-tags-field-row nacos-i18n-lang-card" key={lang}>
                  <label>{lang}</label>
                  <TextArea
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    value={selectedValues[lang] || ""}
                    placeholder={`请输入 ${lang} 翻译文案`}
                    onChange={(event) => updateValue(lang, selectedKey, event.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="nacos-tags-preview-section nacos-i18n-preview-section">
              <div className="nacos-tags-preview-header">当前 key 预览</div>
              <pre className="nacos-tags-preview-pre">{JSON.stringify({ [selectedKey]: selectedValues }, null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="nacos-tags-editor-empty">
            <div className="nacos-tags-empty-title">选择或添加一个翻译 key</div>
            <div className="nacos-tags-empty-desc">左侧支持按 key 和翻译内容搜索；修改后点击「发布到 Nacos」一次性覆盖写入。</div>
          </div>
        )}
      </ConfigWorkbench>
    </PermissionGuard>
  );
}
