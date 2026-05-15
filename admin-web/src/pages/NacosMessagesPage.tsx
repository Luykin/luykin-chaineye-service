import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "antd";
import { ConfigWorkbench } from "@/components/config/ConfigWorkbench";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { fetchNacosConfig, publishNacosConfig } from "@/services/nacos";
import { sanitizeRichTextHtml } from "@/utils/richTextSanitizer";

type MessageLang = "zh" | "en";

type NacosMessageItem = {
  created: number;
  title: string;
  type: "all" | "web3" | "ai" | string;
  content: string;
};

type ToastState = {
  message: string;
  type?: "success" | "error" | "info";
} | null;

const { TextArea } = Input;
const DATA_IDS: Record<MessageLang, string> = {
  zh: "xhunt_message",
  en: "xhunt_message_en",
};
const DEFAULT_FOOTER_HTML = `<br>请加入我们的<a href='https://t.me/xhunt_ai' target='_blank' style='color:rgb(29, 155, 240)'>电报群</a>获取最新资讯。`;
const TOOLBAR_ICONS = {
  refresh: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  ),
  add: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  delete: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  publish: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
};
const QUILL_COLORS = [
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#0066cc",
  "#9933ff",
  "rgb(29, 155, 240)",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#cce0f5",
  "#ebd6ff",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b966",
  "#66a3e0",
  "#c285ff",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0047b2",
  "#6b24b2",
];

function fmtTs(ts: number | string | undefined) {
  const n = Number(ts);
  if (!n) return "-";
  try {
    return new Date(n).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return String(ts);
  }
}

function escapeHtml(value: unknown) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function removeBlackColors(html: string) {
  if (!html || typeof html !== "string") return html;
  const temp = document.createElement("div");
  temp.innerHTML = sanitizeRichTextHtml(html);
  const blackPatterns = [
    /^#000000$/i,
    /^#000$/i,
    /^rgb\s*\(\s*0\s*,\s*0\s*,\s*0\s*\)$/i,
    /^rgba\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[01](?:\.\d+)?\s*\)$/i,
    /^black$/i,
  ];
  const isBlack = (color: string) =>
    blackPatterns.some((pattern) => pattern.test(color.trim()));
  temp.querySelectorAll("*").forEach((el) => {
    const style = el.getAttribute("style");
    if (!style) return;
    const newStyles = style
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((rule) => {
        const match = rule.match(/^\s*([^:]+)\s*:\s*(.+)\s*$/);
        if (!match) return true;
        return !(
          match[1].trim().toLowerCase() === "color" && isBlack(match[2])
        );
      });
    if (newStyles.length) el.setAttribute("style", newStyles.join("; "));
    else el.removeAttribute("style");
  });
  return temp.innerHTML;
}

function parseItems(content: string) {
  const parsed = JSON.parse(content || "[]") as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    const value =
      item && typeof item === "object"
        ? (item as Partial<NacosMessageItem>)
        : {};
    return {
      created: Number(value.created || Date.now()),
      title: String(value.title || ""),
      type: String(value.type || "all"),
      content: sanitizeRichTextHtml(String(value.content || "")),
    };
  });
}

function cloneItems(items: NacosMessageItem[]) {
  return JSON.parse(JSON.stringify(items)) as NacosMessageItem[];
}

function buildPatchHtml(
  oldItems: NacosMessageItem[],
  nextItems: NacosMessageItem[],
) {
  const oldJson = JSON.stringify(oldItems || [], null, 2);
  const newJson = JSON.stringify(nextItems, null, 2);
  if (oldJson === newJson) return escapeHtml(newJson);
  if (window.Diff?.createPatch) {
    return window.Diff.createPatch(
      "config.json",
      oldJson,
      newJson,
      "原始",
      "新",
    )
      .split("\n")
      .slice(4)
      .map((line) => {
        if (line.startsWith("+"))
          return `<span class="added">${escapeHtml(line)}</span>`;
        if (line.startsWith("-"))
          return `<span class="removed">${escapeHtml(line)}</span>`;
        return escapeHtml(line);
      })
      .join("\n");
  }
  return escapeHtml(newJson);
}

export function NacosMessagesPage() {
  const [lang, setLang] = useState<MessageLang>("zh");
  const [items, setItems] = useState<NacosMessageItem[]>([]);
  const [originalItems, setOriginalItems] = useState<NacosMessageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [htmlModalOpen, setHtmlModalOpen] = useState(false);
  const [htmlSource, setHtmlSource] = useState("");
  const [jsonPreviewOpen, setJsonPreviewOpen] = useState(false);
  const [jsonPreviewHtml, setJsonPreviewHtml] = useState("");
  const [diffHint, setDiffHint] = useState("");
  const [quillReady, setQuillReady] = useState(false);

  const quillHostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<any>(null);
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const suppressEditorChangeRef = useRef(false);
  const currentIndexRef = useRef(currentIndex);
  const editorEnabledRef = useRef(false);
  const selectedItem = currentIndex >= 0 ? items[currentIndex] : undefined;
  const dataId = DATA_IDS[lang];
  const editorEnabled = !!selectedItem;

  const sortedItems = useMemo(
    () =>
      [...items]
        .map((item, index) => ({ item, index }))
        .sort(
          (a, b) => Number(b.item.created || 0) - Number(a.item.created || 0),
        ),
    [items],
  );

  function showToast(
    message: string,
    type: "success" | "error" | "info" = "info",
  ) {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2400);
  }

  function updateItem(index: number, patch: Partial<NacosMessageItem>) {
    setItems((prev) => {
      if (!prev[index]) return prev;
      const next = cloneItems(prev);
      next[index] = { ...next[index], ...patch };
      return next;
    });
    setDirty(true);
  }

  function getEditorHtml() {
    if (quillReady && quillRef.current?.root) {
      return removeBlackColors(
        sanitizeRichTextHtml(quillRef.current.root.innerHTML || ""),
      );
    }
    return removeBlackColors(
      sanitizeRichTextHtml(fallbackRef.current?.innerHTML || ""),
    );
  }

  function setEditorHtml(html: string) {
    const cleaned = removeBlackColors(sanitizeRichTextHtml(html || ""));
    suppressEditorChangeRef.current = true;
    if (quillReady && quillRef.current?.clipboard) {
      quillRef.current.clipboard.dangerouslyPasteHTML(cleaned);
    } else if (fallbackRef.current) {
      fallbackRef.current.innerHTML = cleaned;
    }
    window.setTimeout(() => {
      suppressEditorChangeRef.current = false;
    }, 0);
  }

  function syncContentFromEditor() {
    const index = currentIndexRef.current;
    if (
      !editorEnabledRef.current ||
      index < 0 ||
      suppressEditorChangeRef.current
    )
      return;
    const content = getEditorHtml();
    updateItem(index, { content });
  }

  function execFallbackCommand(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    syncContentFromEditor();
  }

  async function loadConfig(
    nextLang = lang,
    options: { silent?: boolean } = {},
  ) {
    if (dirty && !options.silent) {
      const confirmed = window.confirm(
        "当前有未发布改动，确定重新加载并丢弃这些改动吗？",
      );
      if (!confirmed) return;
    }
    setLoading(true);
    try {
      const resp = await fetchNacosConfig({
        dataId: DATA_IDS[nextLang],
        group: "DEFAULT_GROUP",
      });
      const nextItems = parseItems(resp.data.content || "[]");
      setOriginalItems(cloneItems(nextItems));
      setItems(nextItems);
      setCurrentIndex(-1);
      setDirty(false);
      setEditorHtml("");
      if (!options.silent) showToast("配置已加载", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "加载配置失败",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  function selectItem(index: number) {
    const item = items[index];
    setCurrentIndex(index);
    setEditorHtml(item?.content || "");
  }

  function switchLang(nextLang: MessageLang) {
    setLang(nextLang);
    void loadConfig(nextLang, { silent: true });
  }

  function newItem() {
    const item: NacosMessageItem = {
      created: Date.now(),
      title: "",
      type: "all",
      content: DEFAULT_FOOTER_HTML,
    };
    setItems((prev) => [item, ...prev]);
    setCurrentIndex(0);
    setDirty(true);
    window.setTimeout(() => setEditorHtml(item.content), 0);
  }

  function deleteCurrent() {
    if (!selectedItem) return;
    if (!window.confirm("确定删除这条公告？")) return;
    setItems((prev) => prev.filter((_, index) => index !== currentIndex));
    setCurrentIndex(-1);
    setDirty(true);
    setEditorHtml("");
    showToast("已删除，记得点击发布", "success");
  }

  function openHtmlModal() {
    setHtmlSource(getEditorHtml());
    setHtmlModalOpen(true);
    window.setTimeout(() => {
      const textarea = document.getElementById(
        "nacos-html-source",
      ) as HTMLTextAreaElement | null;
      textarea?.focus();
      textarea?.select();
    }, 100);
  }

  function saveHtmlFromModal() {
    const cleaned = removeBlackColors(sanitizeRichTextHtml(htmlSource || ""));
    setEditorHtml(cleaned);
    if (editorEnabled) updateItem(currentIndex, { content: cleaned });
    setHtmlModalOpen(false);
  }

  function showPublishPreview() {
    const oldJson = JSON.stringify(originalItems || [], null, 2);
    const newJson = JSON.stringify(items, null, 2);
    const delta = items.length - (originalItems || []).length;
    setDiffHint(
      oldJson === newJson
        ? "（无变更）"
        : `（${delta > 0 ? "+" : ""}${delta} 条）`,
    );
    setJsonPreviewHtml(buildPatchHtml(originalItems, items));
    setJsonPreviewOpen(true);
  }

  async function doPublish() {
    setPublishing(true);
    try {
      const payload = JSON.stringify(items);
      const result = await publishNacosConfig({
        dataId,
        group: "DEFAULT_GROUP",
        content: payload,
        source: "nacos-messages",
      });
      if (!result.success) throw new Error(result.error || "发布失败");
      setOriginalItems(cloneItems(items));
      setDirty(false);
      setJsonPreviewOpen(false);
      showToast("发布成功", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    void loadConfig(lang, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    editorEnabledRef.current = editorEnabled;
  }, [currentIndex, editorEnabled]);

  useEffect(() => {
    if (!quillHostRef.current || quillRef.current || !window.Quill) return;
    const Quill = window.Quill as any;
    const sizeClasses: Record<string, string> = {
      small: "小",
      "": "正常",
      large: "大",
      huge: "特大",
    };
    const toolbarOptions = {
      container: [
        [{ size: ["small", false, "large", "huge"] }],
        [{ color: QUILL_COLORS }, { background: QUILL_COLORS }],
        ["bold", "italic", "underline"],
        ["link"],
        ["clean"],
        ["html", "eyedropper"],
      ],
      handlers: {
        html: () => openHtmlModal(),
        eyedropper: async () => {
          const EyeDropperCtor = (window as any).EyeDropper;
          if (!EyeDropperCtor) {
            showToast("浏览器不支持 EyeDropper API", "error");
            return;
          }
          try {
            const result = await new EyeDropperCtor().open();
            if (quillRef.current && result.sRGBHex)
              quillRef.current.format("color", result.sRGBHex);
          } catch (error: any) {
            if (error?.name !== "AbortError")
              showToast("颜色提取失败", "error");
          }
        },
      },
    };
    const quill = new Quill(quillHostRef.current, {
      theme: "snow",
      modules: { toolbar: toolbarOptions, clipboard: { matchVisual: false } },
    });
    quillRef.current = quill;
    setQuillReady(true);
    quill.on("text-change", () => syncContentFromEditor());
    quill.root.addEventListener("paste", (event: ClipboardEvent) => {
      try {
        const html = event.clipboardData?.getData("text/html") || "";
        const text = event.clipboardData?.getData("text/plain") || "";
        const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(text);
        let toInsert = html.trim() ? html : looksLikeHtml ? text : "";
        if (!toInsert) return;
        toInsert = removeBlackColors(sanitizeRichTextHtml(toInsert));
        event.preventDefault();
        const range = quill.getSelection(true) || {
          index: quill.getLength(),
          length: 0,
        };
        quill.clipboard.dangerouslyPasteHTML(range.index, toInsert, "user");
        quill.setSelection(range.index + 1, 0, "silent");
      } catch {}
    });
    window.setTimeout(() => {
      const htmlBtn = document.querySelector(".ql-html");
      if (htmlBtn) {
        htmlBtn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>';
        htmlBtn.setAttribute("title", "编辑HTML源码");
      }
      const eyeBtn = document.querySelector(".ql-eyedropper");
      if (eyeBtn) {
        eyeBtn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20.2 3.8l-2.5 2.5-1.4-1.4 2.5-2.5 1.4 1.4zM4 16l-1 5 5-1 9.5-9.5-4-4L4 16z"/></svg>';
        eyeBtn.setAttribute("title", "屏幕拾色");
      }
      const cleanBtn = document.querySelector(".ql-clean");
      if (cleanBtn) {
        cleanBtn.innerHTML = "🧹 ";
        cleanBtn.setAttribute(
          "title",
          "选中内容后点此清除颜色和格式，确保继承主题颜色",
        );
      }
      const boldBtn = document.querySelector(".ql-bold");
      if (boldBtn) boldBtn.setAttribute("title", "加粗 (Ctrl+B)");
      const italicBtn = document.querySelector(".ql-italic");
      if (italicBtn) italicBtn.setAttribute("title", "斜体 (Ctrl+I)");
      const underlineBtn = document.querySelector(".ql-underline");
      if (underlineBtn) underlineBtn.setAttribute("title", "下划线 (Ctrl+U)");
      const linkBtn = document.querySelector(".ql-link");
      if (linkBtn) linkBtn.setAttribute("title", "插入链接 (Ctrl+K)");
      const sizePicker = document.querySelector(".ql-size .ql-picker-label");
      if (sizePicker) sizePicker.setAttribute("title", "字号大小");
      const colorPicker = document.querySelector(".ql-color .ql-picker-label");
      if (colorPicker)
        colorPicker.setAttribute(
          "title",
          "文字颜色 - 建议尽量用默认，如需高亮可选亮色",
        );
      const bgPicker = document.querySelector(
        ".ql-background .ql-picker-label",
      );
      if (bgPicker) bgPicker.setAttribute("title", "背景高亮");
      document
        .querySelectorAll<HTMLElement>(".ql-size .ql-picker-label")
        .forEach((el) =>
          el.setAttribute(
            "data-label",
            sizeClasses[el.dataset.value || ""] || "正常",
          ),
        );
      document
        .querySelectorAll<HTMLElement>(".ql-size .ql-picker-item")
        .forEach((el) => {
          el.textContent = sizeClasses[el.dataset.value || ""] || "正常";
        });
    }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quillHostRef.current]);

  useEffect(() => {
    if (selectedItem) setEditorHtml(selectedItem.content || "");
    else setEditorHtml("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, quillReady]);

  useEffect(() => {
    if (quillRef.current) quillRef.current.enable(editorEnabled);
  }, [editorEnabled]);

  useEffect(() => {
    if (!htmlModalOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        saveHtmlFromModal();
      }
      if (event.key === "Escape") setHtmlModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlModalOpen, htmlSource, editorEnabled, currentIndex]);

  return (
    <PermissionGuard permission="nacos-messages">
      <ConfigWorkbench
        className="nacos-section nacos-section-react"
        title="公告配置"
        description="维护插件公告内容，支持中文 / English 两套 Nacos 配置。"
        toolbar={
          <>
            <div className="toolbar-left">
              <div className="lang-tabs">
                <button
                  className={`lang-tab ${lang === "zh" ? "active" : ""}`}
                  type="button"
                  onClick={() => switchLang("zh")}
                >
                  中文
                </button>
                <button
                  className={`lang-tab ${lang === "en" ? "active" : ""}`}
                  type="button"
                  onClick={() => switchLang("en")}
                >
                  English
                </button>
              </div>
            </div>

            <div className="toolbar-right nacos-react-toolbar-actions">
              <Button
                className="config-action config-action-secondary nacos-btn nacos-btn-secondary"
                htmlType="button"
                onClick={() => void loadConfig(lang)}
                disabled={loading}
                loading={loading}
              >
                {TOOLBAR_ICONS.refresh}重新加载
              </Button>
              <Button
                className="config-action config-action-primary nacos-btn nacos-btn-primary"
                htmlType="button"
                onClick={newItem}
              >
                {TOOLBAR_ICONS.add}新增公告
              </Button>
              <Button
                className="config-action config-action-danger nacos-btn nacos-btn-danger"
                htmlType="button"
                danger
                onClick={deleteCurrent}
                disabled={!editorEnabled}
              >
                {TOOLBAR_ICONS.delete}删除
              </Button>
              <Button
                className="config-action config-action-primary nacos-btn nacos-btn-primary"
                htmlType="button"
                onClick={showPublishPreview}
                disabled={!editorEnabled || publishing}
              >
                {TOOLBAR_ICONS.publish}发布
              </Button>
            </div>
          </>
        }
        sidebarTitle={<span>公告列表</span>}
        sidebarMeta={`${items.length} 条`}
        sidebar={
          <div className="config-workbench-list">
            {sortedItems.length ? (
              sortedItems.map(({ item, index }) => (
                <button
                  key={`${item.created}-${index}`}
                  type="button"
                  className={`config-workbench-list-item nacos-msg-item ${index === currentIndex ? "active" : ""}`}
                  onClick={() => selectItem(index)}
                >
                  <span className="config-workbench-list-title msg-item-title">
                    {item.title || "(无标题)"}
                  </span>
                  <span className="config-workbench-list-meta msg-item-meta">
                    {fmtTs(item.created)}
                  </span>
                </button>
              ))
            ) : (
              <div className="config-workbench-empty empty-state">
                暂无公告，点击「新增公告」创建
              </div>
            )}
          </div>
        }
        editorId="nacos-editor-panel"
        editorTitle="编辑器"
        editorMeta={
          selectedItem
            ? `正在编辑: ${selectedItem.created || ""}`
            : "选择左侧公告开始编辑"
        }
      >
        <div className="editor-form">
          <div className="form-field">
            <label>标题</label>
            <Input
              className="nacos-input"
              value={selectedItem?.title || ""}
              placeholder="请输入公告标题"
              disabled={!editorEnabled}
              onChange={(event) =>
                updateItem(currentIndex, { title: event.target.value })
              }
            />
          </div>

          <div className="form-field">
            <label>类型</label>
            <Select
              className="nacos-input nacos-select"
              value={selectedItem?.type || "all"}
              disabled={!editorEnabled}
              onChange={(value) => updateItem(currentIndex, { type: value })}
              options={[
                { value: "all", label: "全部" },
                { value: "web3", label: "Web3" },
                { value: "ai", label: "AI" },
              ]}
            />
          </div>

          <div className="form-field">
            <label>内容</label>
            <div className="editor-color-notice">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                <strong>⚠️ 重要提示：</strong>粘贴内容后，请先
                <strong>全选(Ctrl+A)</strong>然后点击工具栏的{" "}
                <strong>🧹 清除样式</strong>{" "}
                按钮，确保文字颜色继承自主题，如需特殊高亮语句清楚颜色后单独再设置颜色。发布后请在白天/黑夜模式下都检查一下显示效果。
              </span>
            </div>

            <div
              className={quillReady ? "" : "nacos-hidden"}
              style={{
                display: editorEnabled && quillReady ? "block" : "none",
              }}
            >
              <div ref={quillHostRef} id="nacos-msg-content" />
            </div>

            <div className={quillReady ? "nacos-hidden" : ""}>
              <div className="rte-toolbar">
                <button
                  type="button"
                  title="加粗"
                  disabled={!editorEnabled}
                  onClick={() => execFallbackCommand("bold")}
                >
                  {" "}
                  <b>B</b>{" "}
                </button>
                <button
                  type="button"
                  title="斜体"
                  disabled={!editorEnabled}
                  onClick={() => execFallbackCommand("italic")}
                >
                  {" "}
                  <i>I</i>{" "}
                </button>
                <button
                  type="button"
                  title="下划线"
                  disabled={!editorEnabled}
                  onClick={() => execFallbackCommand("underline")}
                >
                  {" "}
                  <u>U</u>{" "}
                </button>
                <button
                  type="button"
                  title="换行"
                  disabled={!editorEnabled}
                  onClick={() => execFallbackCommand("insertHTML", "<br>")}
                >
                  ↵
                </button>
                <button
                  type="button"
                  title="插入链接"
                  disabled={!editorEnabled}
                  onClick={() => {
                    const url = window.prompt("输入链接 URL:");
                    if (url) execFallbackCommand("createLink", url);
                  }}
                >
                  🔗
                </button>
                <button
                  type="button"
                  title="移除链接"
                  disabled={!editorEnabled}
                  onClick={() => execFallbackCommand("unlink")}
                >
                  ✕
                </button>
                <span className="toolbar-hint">支持直接粘贴 HTML</span>
              </div>
              <div
                ref={fallbackRef}
                className="rte-editor"
                contentEditable={editorEnabled}
                data-placeholder="请输入公告内容（支持 HTML）"
                onInput={syncContentFromEditor}
              />
            </div>
          </div>

          <div className="preview-section">
            <div className="preview-header">
              <span>实时预览</span>
            </div>
            <div
              className="preview-box"
              dangerouslySetInnerHTML={{
                __html: sanitizeRichTextHtml(selectedItem?.content || ""),
              }}
            />
          </div>

          <div className="help-section">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p>
              发布到 Nacos
              会覆盖当前语言的整个公告数组。建议每条公告使用时间戳（毫秒）作为
              created 字段。
            </p>
          </div>
        </div>
      </ConfigWorkbench>

      {toast ? (
        <div
          className="nacos-toast"
          style={{
            background:
              toast.type === "error"
                ? "#991b1b"
                : toast.type === "success"
                  ? "#065f46"
                  : "#111827",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      {htmlModalOpen ? (
        <div className="nacos-modal">
          <div
            className="modal-backdrop"
            onClick={() => setHtmlModalOpen(false)}
          />
          <div className="modal-panel">
            <div className="modal-header">
              <h3>编辑 HTML 源码</h3>
              <Button
                className="modal-close"
                htmlType="button"
                type="text"
                onClick={() => setHtmlModalOpen(false)}
              >
                &times;
              </Button>
            </div>
            <div className="modal-body">
              <TextArea
                id="nacos-html-source"
                value={htmlSource}
                onChange={(event) => setHtmlSource(event.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="modal-footer">
              <Button
                className="config-action config-action-secondary nacos-btn nacos-btn-secondary"
                htmlType="button"
                onClick={() => setHtmlModalOpen(false)}
              >
                取消
              </Button>
              <Button
                className="config-action config-action-primary nacos-btn nacos-btn-primary"
                htmlType="button"
                onClick={saveHtmlFromModal}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {jsonPreviewOpen ? (
        <div className="nacos-modal">
          <div
            className="modal-backdrop"
            onClick={() => setJsonPreviewOpen(false)}
          />
          <div className="modal-panel modal-panel-lg">
            <div className="modal-header">
              <h3>预览 JSON 配置</h3>
              <Button
                className="modal-close"
                htmlType="button"
                type="text"
                onClick={() => setJsonPreviewOpen(false)}
              >
                &times;
              </Button>
            </div>
            <div className="modal-body">
              <div className="preview-info">
                <span>即将发布到 Nacos</span>
                <span>{diffHint}</span>
                <div className="legend">
                  <span className="legend-added">新增</span>
                  <span className="legend-removed">删除</span>
                </div>
              </div>
              <pre
                id="nacos-msg-json-preview-content"
                dangerouslySetInnerHTML={{ __html: jsonPreviewHtml }}
              />
            </div>
            <div className="modal-footer">
              <Button
                className="config-action config-action-secondary nacos-btn nacos-btn-secondary"
                htmlType="button"
                onClick={() => setJsonPreviewOpen(false)}
              >
                取消
              </Button>
              <Button
                className="config-action config-action-primary nacos-btn nacos-btn-primary"
                htmlType="button"
                onClick={() => void doPublish()}
                disabled={publishing}
                loading={publishing}
              >
                确认发布
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </PermissionGuard>
  );
}
