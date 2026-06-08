import { useEffect, useMemo, useRef, useState } from "react";
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
import { fetchNacosConfig, fetchNacosI18nReference, publishNacosConfig } from "@/services/nacos";

const { TextArea } = Input;

const DATA_ID = "xhunt_i18n";
const GROUP = "DEFAULT_GROUP";
const DISPLAY_NAMESPACE = "public";
const DEFAULT_LANGS = ["zh", "en"];
const DRAFT_STORAGE_KEY = "xhunt-admin:nacos-i18n:draft";
type I18nConfig = Record<string, Record<string, string>>;
type KeyStatus = "new" | "modified" | "clean";
type I18nDraft = { config: I18nConfig; selectedKey?: string | null; savedAt?: number };

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

function keyExists(config: I18nConfig, key: string) {
  return Object.values(config).some((langMap) => Object.prototype.hasOwnProperty.call(langMap || {}, key));
}

function getKeyValues(config: I18nConfig, key: string) {
  const langs = Object.keys(config).sort();
  const values: Record<string, string> = {};
  langs.forEach((lang) => {
    values[lang] = config[lang]?.[key] ?? "";
  });
  return JSON.stringify(values);
}

function getKeyStatus(config: I18nConfig, baseline: I18nConfig, key: string): KeyStatus {
  if (!keyExists(baseline, key)) return "new";
  return getKeyValues(config, key) === getKeyValues(baseline, key) ? "clean" : "modified";
}

function readSavedDraft(): I18nDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<I18nDraft>;
    if (!parsed || !parsed.config) return null;
    return {
      config: parseI18nContent(JSON.stringify(parsed.config)),
      selectedKey: parsed.selectedKey || null,
      savedAt: Number(parsed.savedAt || 0),
    };
  } catch {
    return null;
  }
}

function removeSavedDraft() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore localStorage errors
  }
}

function formatDraftTime(value?: number) {
  if (!value) return "未知时间";
  try {
    return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return String(value);
  }
}

export function NacosI18nPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<I18nConfig>(() => parseI18nContent("{}"));
  const [baseline, setBaseline] = useState<I18nConfig>(() => parseI18nContent("{}"));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const draftPromptedRef = useRef(false);

  const query = useQuery({
    queryKey: ["nacos-i18n", DATA_ID, GROUP],
    queryFn: () => fetchNacosConfig({ dataId: DATA_ID, group: GROUP }),
  });
  const referenceQuery = useQuery({
    queryKey: ["open-source-i18n-reference"],
    queryFn: fetchNacosI18nReference,
    staleTime: 5 * 60 * 1000,
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
  const referenceConfig = parseI18nContent(JSON.stringify(referenceQuery.data?.data?.config || {}));
  const referenceKeys = useMemo(() => getAllKeys(referenceConfig), [referenceConfig]);
  const keyStatusMap = useMemo(() => {
    return Object.fromEntries(allKeys.map((key) => [key, getKeyStatus(config, baseline, key)])) as Record<string, KeyStatus>;
  }, [allKeys, baseline, config]);
  const pendingKeyCount = allKeys.filter((key) => keyStatusMap[key] !== "clean").length;

  useEffect(() => {
    if (query.data?.data?.content == null || dirty) return;
    try {
      const next = parseI18nContent(query.data.data.content);
      const nextBaseline = cloneConfig(next);
      setBaseline(nextBaseline);

      const savedDraft = draftPromptedRef.current ? null : readSavedDraft();
      draftPromptedRef.current = true;
      if (savedDraft && window.confirm(`检测到未发布草稿（${formatDraftTime(savedDraft.savedAt)}），是否恢复？`)) {
        const draftKeys = getAllKeys(savedDraft.config);
        setConfig(savedDraft.config);
        setSelectedKey(savedDraft.selectedKey && draftKeys.includes(savedDraft.selectedKey) ? savedDraft.selectedKey : draftKeys[0] || null);
        return;
      }

      setConfig(next);
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
      const seedLangs = Array.from(new Set([...langs, ...DEFAULT_LANGS, ...Object.keys(referenceConfig)]));
      seedLangs.forEach((lang) => {
        next[lang] = next[lang] || {};
        next[lang][key] = referenceConfig[lang]?.[key] || "";
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

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ config, selectedKey, savedAt: Date.now() }));
      messageApi.success("草稿已保存，可继续编辑多个 key 后统一发布");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "草稿保存失败");
    }
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
      removeSavedDraft();
      messageApi.success("翻译配置已发布到 Nacos，草稿已清除");
      void query.refetch();
    },
    onError: (error: Error) => messageApi.error(error.message || "发布失败"),
  });

  return (
    <PermissionGuard permission="nacos-i18n">
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
            <Button icon={<SaveOutlined />} disabled={!dirty} onClick={saveDraft}>保存草稿</Button>
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
              <Input allowClear variant="borderless" size="small" placeholder="搜索 key / 翻译内容..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="nacos-tags-list config-workbench-list">
              {filteredKeys.length ? filteredKeys.map((key) => {
                const active = key === selectedKey;
                const zh = config.zh?.[key] || "";
                const status = keyStatusMap[key] || "clean";
                const statusText = status === "new" ? "新建" : status === "modified" ? "已修改" : "";
                const className = [
                  "config-workbench-list-item",
                  "nacos-tags-item",
                  active ? "is-active active" : "",
                  status !== "clean" ? `is-${status}` : "",
                ].filter(Boolean).join(" ");
                return (
                  <button key={key} type="button" className={className} onClick={() => setSelectedKey(key)}>
                    <span className="nacos-tags-item-count">K</span>
                    <span className="nacos-tags-item-main">
                      <span className="nacos-tags-item-title-row">
                        <span className="nacos-tags-item-handle">{key}</span>
                        {statusText ? <span className={`nacos-i18n-status-chip is-${status}`}>{statusText}</span> : null}
                      </span>
                      <span className="nacos-tags-item-preview">
                        <span className="nacos-tags-mini-chip">{zh || "未配置中文"}</span>
                      </span>
                    </span>
                  </button>
                );
              }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的翻译 key" />}
            </div>
          </>
        }
        editorTitle={selectedKey || "选择一个翻译 key"}
        editorMeta={selectedKey ? `${langs.length} 个语言字段${keyStatusMap[selectedKey] === "new" ? " · 新建未发布" : keyStatusMap[selectedKey] === "modified" ? " · 修改未发布" : ""}` : "可搜索、添加、删除 key"}
      >
        {query.isError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="加载 Nacos 翻译配置失败" /> : null}
        {parseError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message="Nacos 内容不是合法的翻译 JSON" description={parseError} /> : null}

        <div className="nacos-tags-stats nacos-i18n-stats">
          <div className="nacos-tags-stat-card"><span>Key 总数</span><strong>{allKeys.length}</strong></div>
          <div className="nacos-tags-stat-card"><span>语言</span><strong>{langs.join(" / ")}</strong></div>
          <div className="nacos-tags-stat-card"><span>空翻译</span><strong>{missingCount}</strong></div>
          <div className="nacos-tags-stat-card"><span>未发布 key</span><strong>{pendingKeyCount}</strong></div>
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

        <div className="nacos-i18n-reference-section">
          <div className="nacos-i18n-reference-header">
            <div>
              <div className="nacos-i18n-reference-kicker">开源库已有 key 参考</div>
              <h3>包内 locales 参考表</h3>
              <p>来自开源库 tweet-hunt-extension 的 zh.json / en.json。Nacos 配置里的同名 key 会覆盖包内已有 key；Nacos 不需要配置全量 key，缺失时可参考包内默认文案。</p>
            </div>
            <div className="nacos-i18n-reference-metrics">
              <span>{referenceKeys.length} keys</span>
            </div>
          </div>

          {referenceQuery.isError ? (
            <Alert
              type="warning"
              showIcon
              message="开源库 locales 参考读取失败"
              description={referenceQuery.error instanceof Error ? referenceQuery.error.message : "请检查后端转发接口或 GitHub raw 网络状态"}
            />
          ) : (
            <div className="nacos-i18n-reference-table-wrap">
              <table className="nacos-i18n-reference-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>zh.json</th>
                    <th>en.json</th>
                  </tr>
                </thead>
                <tbody>
                  {referenceQuery.isLoading ? (
                    <tr><td colSpan={3}>正在读取开源库已有 key...</td></tr>
                  ) : referenceKeys.length ? referenceKeys.map((key) => (
                    <tr key={key}>
                      <td className="nacos-i18n-reference-key">{key}</td>
                      <td>{referenceConfig.zh?.[key] || ""}</td>
                      <td>{referenceConfig.en?.[key] || ""}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={3}>暂无开源库参考 key</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ConfigWorkbench>
    </PermissionGuard>
  );
}
