import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CodeOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";

/**
 * 危险标签黑名单
 */
const IGNORED_TAGS = new Set(["script", "style", "iframe", "textarea", "noscript"]);

/**
 * 允许的富文本标签白名单
 */
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "strike",
  "span",
  "p",
  "div",
  "br",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "img",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "title", "class", "style"]),
  b: new Set(["class", "style"]),
  strong: new Set(["class", "style"]),
  i: new Set(["class", "style"]),
  em: new Set(["class", "style"]),
  u: new Set(["class", "style"]),
  s: new Set(["class", "style"]),
  del: new Set(["class", "style"]),
  strike: new Set(["class", "style"]),
  span: new Set(["class", "style"]),
  p: new Set(["class", "style"]),
  div: new Set(["class", "style"]),
  br: new Set([]),
  ul: new Set(["class", "style"]),
  ol: new Set(["class", "style"]),
  li: new Set(["class", "style"]),
  blockquote: new Set(["class", "style"]),
  code: new Set(["class", "style"]),
  pre: new Set(["class", "style"]),
  h1: new Set(["class", "style"]),
  h2: new Set(["class", "style"]),
  h3: new Set(["class", "style"]),
  h4: new Set(["class", "style"]),
  img: new Set(["src", "alt", "class", "style", "width", "height"]),
};

const ALLOWED_STYLE_PROPS = new Set([
  "background-color",
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "text-align",
  "text-decoration",
  "line-height",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
]);

/**
 * 过滤行内样式，仅保留安全属性与值
 */
function sanitizeInlineStyle(rawStyle: string): string {
  if (!rawStyle) return "";
  return rawStyle
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const idx = rule.indexOf(":");
      if (idx === -1) return "";
      const prop = rule.slice(0, idx).trim().toLowerCase();
      const val = rule.slice(idx + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return "";
      if (!val || /expression|url|javascript/i.test(val)) return "";
      if (!/^[#(),.%-\s\w"'/]+$/i.test(val)) return "";
      return `${prop}: ${val}`;
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * 完整调色盘：包含 Twitter/X 官方品牌蓝、高饱和度主色、柔和高亮底色与暗色系
 */
export const QUILL_COLORS = [
  "#000000",
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#0066cc",
  "#9933ff",
  "rgb(29, 155, 240)", // Twitter/X Blue
  "#ffffff",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#cce0f5",
  "#ebd6ff",
  "#d4eafd",
  "#5c5c5c",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b966",
  "#66a3e0",
  "#c285ff",
  "#7ac7fc",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0047b2",
  "#6b24b2",
  "#0d6fb8",
];

/**
 * 常见代币/项目图标快捷预设，方便运营在热点投票中一键插入代币图标
 */
export const PRESET_TOKEN_ICONS = [
  {
    name: "BTC",
    url: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  },
  {
    name: "ETH",
    url: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  },
  {
    name: "SOL",
    url: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  },
  {
    name: "BNB",
    url: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
  },
  {
    name: "DOGE",
    url: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png",
  },
  {
    name: "USDT",
    url: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  },
  {
    name: "PEPE",
    url: "https://assets.coingecko.com/coins/images/29850/small/pepe-token.png",
  },
  {
    name: "X",
    url: "https://abs.twimg.com/favicons/twitter.3.ico",
  },
];

/**
 * 对富文本内容 HTML 做标准 DOM 树遍历过滤，
 * 兼顾行内标签、链接、多段落与白名单标签，与后端白名单 1:1 对齐
 */
export function sanitizeRichTitleHtml(rawHtml: string, allowNewline = true): string {
  if (!rawHtml) return "";

  const template = document.createElement("template");
  template.innerHTML = rawHtml;

  function walk(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    // 剔除危险标签及其整个内部节点
    if (IGNORED_TAGS.has(tag)) {
      return null;
    }

    // 单行标题模式时，把块标签展开为内联内容
    if (!allowNewline && (tag === "p" || tag === "div" || tag.startsWith("h"))) {
      const fragment = document.createDocumentFragment();
      Array.from(element.childNodes).forEach((child) => {
        const cleanedChild = walk(child);
        if (cleanedChild) fragment.appendChild(cleanedChild);
      });
      return fragment;
    }

    // 不在白名单内的标签，只保留内部文本或合法子标签
    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      Array.from(element.childNodes).forEach((child) => {
        const cleanedChild = walk(child);
        if (cleanedChild) fragment.appendChild(cleanedChild);
      });
      return fragment;
    }

    const cleanEl = document.createElement(tag);
    const allowedAttrs = ALLOWED_ATTRS[tag] || new Set();

    Array.from(element.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      if (!allowedAttrs.has(attrName)) return;
      if (attrName.startsWith("on")) return;

      if (tag === "img" && attrName === "src") {
        const src = (attr.value || "").trim();
        if (/^https?:\/\//i.test(src) || src.startsWith("data:image/")) {
          cleanEl.setAttribute("src", src);
        }
        return;
      }

      if (tag === "a" && attrName === "href") {
        const href = (attr.value || "").trim();
        if (/^(https?:\/\/|mailto:)/i.test(href)) {
          cleanEl.setAttribute("href", href);
          cleanEl.setAttribute("target", "_blank");
          cleanEl.setAttribute("rel", "noopener noreferrer");
        }
        return;
      }

      if (attrName === "style") {
        const safeStyle = sanitizeInlineStyle(attr.value || "");
        if (safeStyle) cleanEl.setAttribute("style", safeStyle);
        return;
      }

      if (attrName === "class") {
        const safeClass = (attr.value || "")
          .replace(/[^a-zA-Z0-9_\-\s]/g, "")
          .trim();
        if (safeClass) cleanEl.setAttribute("class", safeClass);
        return;
      }

      if (["alt", "width", "height", "title"].includes(attrName)) {
        cleanEl.setAttribute(attrName, attr.value.slice(0, 100));
      }
    });

    if (tag === "img" && !cleanEl.getAttribute("src")) {
      return null;
    }

    Array.from(element.childNodes).forEach((child) => {
      const cleanedChild = walk(child);
      if (cleanedChild) cleanEl.appendChild(cleanedChild);
    });

    return cleanEl;
  }

  const container = document.createElement("div");
  Array.from(template.content.childNodes).forEach((child) => {
    const cleaned = walk(child);
    if (cleaned) container.appendChild(cleaned);
  });

  return container.innerHTML.trim();
}

export function isRichTitleEmpty(html?: string | null): boolean {
  if (!html) return true;
  if (/<img\b[^>]*\ssrc\s*=/i.test(html)) return false;
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  return !stripped;
}

export interface RichTitleEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number | string;
  allowNewline?: boolean;
  defaultShowPreview?: boolean;
}

/**
 * 热点投票富文本编辑器
 * - 复用管理后台已引入的 Quill.js 引擎 (Snow 主题)
 * - 全功能富文本工具栏：字号、标题、文本颜色、背景高亮、粗体、斜体、下划线、删除线、对齐、列表、引用、代码、超链接、配图/代币、清除格式、HTML源码查看/编辑与屏幕拾色器
 * - 底部独立状态栏：避免右上角"效果预览"换行，提供友好排版提示与实时字符计数
 * - 提供所见即所得的“实时效果预览”
 */
export function RichTitleEditor({
  value = "",
  onChange,
  disabled = false,
  placeholder = "输入富文本内容，支持文字加粗/斜体/颜色、超链接与插入代币图标...",
  maxLength = 2000,
  minHeight = 110,
  allowNewline = false,
  defaultShowPreview = false,
}: RichTitleEditorProps) {
  const editorId = useId().replace(/:/g, "_");
  const toolbarId = `rich-title-toolbar-${editorId}`;
  const editorHostRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<any>(null);
  const savedSelectionRef = useRef<{ index: number; length: number } | null>(null);

  const [quillReady, setQuillReady] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [isInlineToken, setIsInlineToken] = useState(true);
  const [showPreview, setShowPreview] = useState(defaultShowPreview);
  const [htmlModalOpen, setHtmlModalOpen] = useState(false);
  const [htmlSource, setHtmlSource] = useState("");

  // 打开插入图片/代币弹窗前保存选区
  const handleOpenImageModal = () => {
    const quill = quillRef.current;
    if (quill) {
      savedSelectionRef.current = quill.getSelection(true) || {
        index: quill.getLength(),
        length: 0,
      };
    }
    setImageModalOpen(true);
  };

  // 打开编辑 HTML 源码弹窗
  const handleOpenHtmlModal = () => {
    const quill = quillRef.current;
    const currentHtml = quill?.root?.innerHTML || "";
    setHtmlSource(currentHtml);
    setHtmlModalOpen(true);
  };

  // 确认并同步 HTML 源码回编辑器
  const handleConfirmHtmlModal = () => {
    const quill = quillRef.current;
    if (quill) {
      const cleaned = sanitizeRichTitleHtml(htmlSource, allowNewline);
      quill.clipboard.dangerouslyPasteHTML(cleaned);
      const finalValue = isRichTitleEmpty(cleaned) ? "" : cleaned;
      onChange?.(finalValue);
    }
    setHtmlModalOpen(false);
  };

  // 初始化 Quill 实例，复用全局已加载的 window.Quill
  useEffect(() => {
    if (!editorHostRef.current || quillRef.current || !window.Quill) return;

    const Quill = window.Quill as any;
    const toolbarOptions = {
      container: `#${toolbarId}`,
      handlers: {
        html: () => handleOpenHtmlModal(),
        image: () => handleOpenImageModal(),
        eyedropper: async () => {
          const EyeDropperCtor = (window as any).EyeDropper;
          if (!EyeDropperCtor) {
            message.warning("当前浏览器不支持屏幕拾色器 API");
            return;
          }
          try {
            const result = await new EyeDropperCtor().open();
            if (quillRef.current && result.sRGBHex) {
              quillRef.current.format("color", result.sRGBHex);
            }
          } catch (e: any) {
            if (e?.name !== "AbortError") {
              message.error("拾取颜色失败");
            }
          }
        },
      },
    };

    const quill = new Quill(editorHostRef.current, {
      theme: "snow",
      modules: {
        toolbar: toolbarOptions,
        keyboard: {
          bindings: {
            enter: {
              key: 13,
              handler: () => {
                if (allowNewline) {
                  return true;
                }
                return false;
              },
            },
          },
        },
        clipboard: { matchVisual: false },
      },
      placeholder,
    });

    quillRef.current = quill;
    setQuillReady(true);

    if (value) {
      quill.clipboard.dangerouslyPasteHTML(value);
    }
    quill.enable(!disabled);

    const onTextChange = () => {
      const rawHtml = quill.root?.innerHTML || "";
      const cleaned = sanitizeRichTitleHtml(rawHtml, allowNewline);
      const finalValue = isRichTitleEmpty(cleaned) ? "" : cleaned;
      onChange?.(finalValue);
    };

    quill.on("text-change", onTextChange);

    return () => {
      quill.off("text-change", onTextChange);
      quillRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变更同步（如表单回填），避免打字时光标重置
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    const currentHtml = sanitizeRichTitleHtml(quill.root?.innerHTML || "", allowNewline);
    const normalizedProp = sanitizeRichTitleHtml(value || "", allowNewline);

    if (currentHtml !== normalizedProp) {
      if (!normalizedProp) {
        quill.setText("");
      } else {
        quill.clipboard.dangerouslyPasteHTML(normalizedProp);
      }
    }
  }, [value, allowNewline]);

  // 禁用状态同步
  useEffect(() => {
    if (quillRef.current) {
      quillRef.current.enable(!disabled);
    }
  }, [disabled]);

  const sanitizedValue = useMemo(() => sanitizeRichTitleHtml(value, allowNewline), [value, allowNewline]);
  const charLength = sanitizedValue.length;
  const isOverLimit = charLength > maxLength;
  const isNearLimit = charLength >= maxLength * 0.8;

  // 插入图片或代币图标到选区
  const handleConfirmImage = () => {
    const trimmedUrl = imageUrl.trim();
    if (!/^https?:\/\//i.test(trimmedUrl) && !trimmedUrl.startsWith("data:image/")) return;

    const quill = quillRef.current;
    if (quill) {
      quill.focus();
      const range = savedSelectionRef.current || quill.getSelection(true) || {
        index: quill.getLength(),
        length: 0,
      };
      const imgClass = isInlineToken ? "token-icon" : "";
      const imgHtml = `<img src="${trimmedUrl}" alt="${imageAlt || ""}" class="${imgClass}" />`;
      quill.clipboard.dangerouslyPasteHTML(range.index, imgHtml, "user");
      quill.setSelection(range.index + 1, 0, "silent");
    }

    setImageModalOpen(false);
    setImageUrl("");
    setImageAlt("");
    setIsInlineToken(true);
    savedSelectionRef.current = null;
  };

  const heightVal = typeof minHeight === "number" ? `${minHeight}px` : (minHeight || "110px");

  return (
    <div
      className="rich-title-editor-wrapper"
      style={{
        ["--rich-editor-min-height" as any]: heightVal,
      }}
    >
      {/* Quill Snow 工具栏：包含字号、标题、颜色、背景、修饰、对齐、列表、引用、超链接、图片/代币、源码编辑、拾色器与清除格式 */}
      <div id={toolbarId} className="rich-title-toolbar">
        {/* 字号与标题级别 */}
        <span className="ql-formats">
          <select className="ql-size" defaultValue="" title="字号">
            <option value="small">小</option>
            <option value="">标准</option>
            <option value="large">大</option>
            <option value="huge">特大</option>
          </select>
          <select className="ql-header" defaultValue="" title="标题级别">
            <option value="2">二级标题</option>
            <option value="3">三级标题</option>
            <option value="">正文</option>
          </select>
        </span>

        {/* 字体颜色与背景高亮 */}
        <span className="ql-formats">
          <select className="ql-color" title="文字颜色">
            {QUILL_COLORS.map((c) => (
              <option key={`c-${c}`} value={c} />
            ))}
          </select>
          <select className="ql-background" title="背景高亮色">
            {QUILL_COLORS.map((c) => (
              <option key={`bg-${c}`} value={c} />
            ))}
          </select>
        </span>

        {/* 基础文字修饰 */}
        <span className="ql-formats">
          <button type="button" className="ql-bold" title="加粗 (Ctrl+B)" />
          <button type="button" className="ql-italic" title="斜体 (Ctrl+I)" />
          <button type="button" className="ql-underline" title="下划线 (Ctrl+U)" />
          <button type="button" className="ql-strike" title="删除线" />
        </span>

        {/* 对齐方式 */}
        <span className="ql-formats">
          <select className="ql-align" defaultValue="" title="对齐方式">
            <option value="" />
            <option value="center" />
            <option value="right" />
            <option value="justify" />
          </select>
        </span>

        {/* 列表、引用、代码 */}
        <span className="ql-formats">
          <button type="button" className="ql-list" value="ordered" title="有序列表" />
          <button type="button" className="ql-list" value="bullet" title="无序列表" />
          <button type="button" className="ql-blockquote" title="引用段落" />
          <button type="button" className="ql-code" title="行内代码" />
        </span>

        {/* 超链接、图片/代币、清除格式 */}
        <span className="ql-formats">
          <button type="button" className="ql-link" title="插入/编辑超链接" />
          <button type="button" className="ql-image" title="插入图片 / 主流代币图标" />
          <button type="button" className="ql-clean" title="清除所有格式" />
        </span>

        {/* HTML 源码与屏幕取色器 */}
        <span className="ql-formats">
          <button type="button" className="ql-html" title="查看/编辑 HTML 源码">
            <CodeOutlined style={{ fontSize: 13 }} />
          </button>
          <button type="button" className="ql-eyedropper" title="屏幕拾色器">
            <span style={{ fontSize: 12, lineHeight: 1 }}>🎨</span>
          </button>
        </span>
      </div>

      {/* Quill 编辑区域 */}
      <div className="rich-title-container">
        <div ref={editorHostRef} className="rich-title-host" />
      </div>

      {/* 底部独立状态栏：避免右上角换行问题，提供贴心提示与右侧实时字数统计/预览切换 */}
      <div className="rich-title-footer">
        <div className="rich-title-footer-tip">
          {allowNewline ? "💡 支持换行、多段落与富文本排版" : "💡 单行标题排版模式"}
        </div>
        <div className="rich-title-footer-actions">
          <button
            type="button"
            className={`rich-title-preview-toggle ${showPreview ? "active" : ""}`}
            onClick={() => setShowPreview(!showPreview)}
            title={showPreview ? "收起效果预览" : "展开效果预览"}
          >
            <EyeOutlined />
            <span>{showPreview ? "收起预览" : "效果预览"}</span>
          </button>
          <span
            className={`rich-title-counter ${isOverLimit ? "over" : isNearLimit ? "warn" : ""}`}
          >
            {charLength}/{maxLength}
          </span>
        </div>
      </div>

      {/* 实时预览展示区 */}
      {showPreview && (
        <div className="rich-title-preview-card">
          <div className="rich-title-preview-header">
            <span className="preview-label">
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              效果实时预览：
            </span>
            <span className="preview-tip">
              （前端用户界面将以该样式渲染展示）
            </span>
          </div>
          <div className="rich-title-preview-body">
            {!isRichTitleEmpty(sanitizedValue) ? (
              <div
                className="rich-title-render-content"
                dangerouslySetInnerHTML={{ __html: sanitizedValue }}
              />
            ) : (
              <Typography.Text type="secondary" italic>
                输入富文本内容后在此实时预览文字修饰、颜色、链接与配图效果
              </Typography.Text>
            )}
          </div>
        </div>
      )}

      {/* 插入代币/图片弹窗 */}
      <Modal
        open={imageModalOpen}
        title="插入图片 / 主流代币图标"
        width={540}
        okText="插入到光标处"
        cancelText="取消"
        onOk={handleConfirmImage}
        onCancel={() => {
          setImageModalOpen(false);
          setImageUrl("");
          setImageAlt("");
          setIsInlineToken(true);
          savedSelectionRef.current = null;
        }}
        okButtonProps={{ disabled: !/^https?:\/\//i.test(imageUrl.trim()) && !imageUrl.trim().startsWith("data:image/") }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              🪙 快捷选择主流代币 / 平台 Logo：
            </Typography.Text>
            <div className="preset-tokens-grid">
              {PRESET_TOKEN_ICONS.map((token) => (
                <Tag
                  key={token.name}
                  className={`preset-token-tag ${imageUrl === token.url ? "selected" : ""}`}
                  onClick={() => {
                    setImageUrl(token.url);
                    setImageAlt(token.name);
                    setIsInlineToken(true);
                  }}
                >
                  <img src={token.url} alt={token.name} className="preset-token-img" />
                  <span>{token.name}</span>
                </Tag>
              ))}
            </div>
          </div>

          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              🖼️ 或输入自定义图片地址 (URL)：
            </Typography.Text>
            <Input
              placeholder="https://...（支持 png/jpg/svg/webp）"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                if (PRESET_TOKEN_ICONS.every((t) => t.url !== e.target.value)) {
                  setIsInlineToken(false);
                }
              }}
              onPressEnter={handleConfirmImage}
              allowClear
            />
          </div>

          <div>
            <Checkbox
              checked={isInlineToken}
              onChange={(e) => setIsInlineToken(e.target.checked)}
            >
              作为行内小图标混排（适合代币 Logo/Emoji；取消则作为常规图片展示）
            </Checkbox>
          </div>

          {imageUrl && (/^https?:\/\//i.test(imageUrl.trim()) || imageUrl.trim().startsWith("data:image/")) && (
            <Card size="small" title="图片效果预览" className="image-preview-card">
              <div className="image-preview-content">
                <span style={{ marginRight: 8 }}>预览：</span>
                {isInlineToken ? (
                  <span className="preview-sample">
                    文本混排
                    <img
                      src={imageUrl.trim()}
                      alt={imageAlt || "preview"}
                      className="token-icon preview-sample-img"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                    示例
                  </span>
                ) : (
                  <img
                    src={imageUrl.trim()}
                    alt={imageAlt || "preview"}
                    style={{ maxWidth: "100%", maxHeight: 120, borderRadius: 4, objectFit: "contain" }}
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                )}
              </div>
            </Card>
          )}
        </Space>
      </Modal>

      {/* 编辑 HTML 源码弹窗 */}
      <Modal
        open={htmlModalOpen}
        title="编辑 HTML 源码"
        width={680}
        okText="确定更新"
        cancelText="取消"
        onOk={handleConfirmHtmlModal}
        onCancel={() => setHtmlModalOpen(false)}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            可直接在此查看或微调 HTML 源码标签与行内样式。保存后将自动通过安全白名单清洗同步回编辑器。
          </Typography.Text>
          <Input.TextArea
            rows={10}
            value={htmlSource}
            onChange={(e) => setHtmlSource(e.target.value)}
            style={{ fontFamily: "SFMono-Regular, Consolas, Menlo, monospace", fontSize: 13 }}
            placeholder="<div>...</div>"
          />
        </Space>
      </Modal>
    </div>
  );
}

