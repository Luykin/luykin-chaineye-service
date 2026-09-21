import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BoldOutlined,
  ClearOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  ItalicOutlined,
  PictureOutlined,
} from "@ant-design/icons";

/**
 * 客户端清洗白名单：与后端 sanitizeVoteTitleHtml / VOTE_TITLE_XSS_OPTIONS 完全一致
 * 仅允许 span/strong/b/em/i/img，剥离 script/style/on* 等
 */
const IGNORED_TAGS = new Set(["script", "style", "iframe", "textarea", "noscript"]);
const ALLOWED_TAGS = new Set(["span", "strong", "b", "em", "i", "img"]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  span: new Set(["class"]),
  strong: new Set(["class"]),
  b: new Set([]),
  em: new Set([]),
  i: new Set([]),
  img: new Set(["src", "alt", "class", "width", "height"]),
};

/**
 * 常见代币/项目图标快捷预设，方便运营在热点投票标题中一键插入代币图标
 */
export const PRESET_TOKEN_ICONS = [
  {
    name: "BTC",
    label: "Bitcoin",
    url: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  },
  {
    name: "ETH",
    label: "Ethereum",
    url: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  },
  {
    name: "SOL",
    label: "Solana",
    url: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  },
  {
    name: "BNB",
    label: "BNB",
    url: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
  },
  {
    name: "DOGE",
    label: "Dogecoin",
    url: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png",
  },
  {
    name: "USDT",
    label: "Tether",
    url: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  },
  {
    name: "PEPE",
    label: "Pepe",
    url: "https://assets.coingecko.com/coins/images/29850/small/pepe-token.png",
  },
  {
    name: "X",
    label: "X (Twitter)",
    url: "https://abs.twimg.com/favicons/twitter.3.ico",
  },
];

/**
 * 对富文本标题 HTML 做标准 DOM 树遍历过滤，
 * 剥离外部包裹的 <p>/<div> 并只保留行内白名单标签，与后端白名单 1:1 对齐
 */
export function sanitizeRichTitleHtml(rawHtml: string): string {
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

    // 如果是 p 或 div 等块标签，把其子节点展开为内联内容（避免标题被 <p> 包裹）
    if (tag === "p" || tag === "div") {
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
        if (/^https?:\/\//i.test(src)) {
          cleanEl.setAttribute("src", src);
        }
        return;
      }

      if (attrName === "class") {
        const safeClass = (attr.value || "")
          .replace(/[^a-zA-Z0-9_\-\s]/g, "")
          .trim();
        if (safeClass) cleanEl.setAttribute("class", safeClass);
        return;
      }

      if (["alt", "width", "height"].includes(attrName)) {
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

/** 富文本内容是否为空（无可见文本且无图片） */
export function isRichTitleEmpty(html?: string | null): boolean {
  if (!html) return true;
  if (/<img\b[^>]*\ssrc\s*=\s*["']https?:/i.test(html)) return false;
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  return !stripped;
}

export interface RichTitleEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

/**
 * 热点投票富文本标题编辑器
 * - 复用管理后台已引入的 Quill.js 引擎
 * - 针对“议题标题”场景做单行/紧凑样式与交互优化
 * - 提供代币图标快捷预设与图片实时预览插入弹窗
 * - 提供所见即所得的“实时效果预览”及字符计数
 */
export function RichTitleEditor({
  value = "",
  onChange,
  disabled = false,
  placeholder = "输入富文本标题，支持文字加粗/斜体及插入代币图标...",
  maxLength = 1000,
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
  const [showPreview, setShowPreview] = useState(true);

  // 初始化 Quill 实例，复用已加载的 window.Quill
  useEffect(() => {
    if (!editorHostRef.current || quillRef.current || !window.Quill) return;

    const Quill = window.Quill as any;
    const quill = new Quill(editorHostRef.current, {
      theme: "snow",
      modules: {
        toolbar: `#${toolbarId}`,
        keyboard: {
          bindings: {
            enter: {
              key: 13,
              handler: () => false, // 标题模式拦截多段落回车
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
      const cleaned = sanitizeRichTitleHtml(rawHtml);
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
    const currentHtml = sanitizeRichTitleHtml(quill.root?.innerHTML || "");
    const normalizedProp = sanitizeRichTitleHtml(value || "");

    if (currentHtml !== normalizedProp) {
      if (!normalizedProp) {
        quill.setText("");
      } else {
        quill.clipboard.dangerouslyPasteHTML(normalizedProp);
      }
    }
  }, [value]);

  // 禁用状态同步
  useEffect(() => {
    if (quillRef.current) {
      quillRef.current.enable(!disabled);
    }
  }, [disabled]);

  const sanitizedValue = useMemo(() => sanitizeRichTitleHtml(value), [value]);
  const charLength = sanitizedValue.length;
  const isOverLimit = charLength > maxLength;
  const isNearLimit = charLength >= maxLength * 0.8;

  // 打开插入图片弹窗前保存选区
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

  // 插入图片到选区
  const handleConfirmImage = () => {
    const trimmedUrl = imageUrl.trim();
    if (!/^https?:\/\//i.test(trimmedUrl)) return;

    const quill = quillRef.current;
    if (quill) {
      quill.focus();
      const range = savedSelectionRef.current || quill.getSelection(true) || {
        index: quill.getLength(),
        length: 0,
      };
      quill.insertEmbed(range.index, "image", trimmedUrl, "user");
      quill.setSelection(range.index + 1, 0, "silent");
    }

    setImageModalOpen(false);
    setImageUrl("");
    setImageAlt("");
    savedSelectionRef.current = null;
  };

  return (
    <div className="rich-title-editor-wrapper">
      {/* Quill Snow 工具栏 */}
      <div id={toolbarId} className="rich-title-toolbar">
        <span className="ql-formats">
          <Tooltip title="加粗 (Ctrl+B)">
            <button type="button" className="ql-bold" aria-label="加粗">
              <BoldOutlined />
            </button>
          </Tooltip>
          <Tooltip title="斜体 (Ctrl+I)">
            <button type="button" className="ql-italic" aria-label="斜体">
              <ItalicOutlined />
            </button>
          </Tooltip>
        </span>

        <span className="ql-formats">
          <Tooltip title="插入代币图标 / 图片">
            <button
              type="button"
              className="rich-title-custom-btn"
              onClick={handleOpenImageModal}
              disabled={disabled}
              aria-label="插入代币图标"
            >
              <PictureOutlined />
              <span className="rich-title-btn-text">图标</span>
            </button>
          </Tooltip>
          <Tooltip title="清除格式">
            <button type="button" className="ql-clean" aria-label="清除格式">
              <ClearOutlined />
            </button>
          </Tooltip>
        </span>

        <div className="rich-title-toolbar-right">
          <Tooltip title={showPreview ? "隐藏实时预览" : "显示实时预览"}>
            <button
              type="button"
              className={`rich-title-preview-toggle ${showPreview ? "active" : ""}`}
              onClick={() => setShowPreview(!showPreview)}
            >
              <EyeOutlined />
              <span>预览</span>
            </button>
          </Tooltip>
          <span
            className={`rich-title-counter ${isOverLimit ? "over" : isNearLimit ? "warn" : ""}`}
          >
            {charLength}/{maxLength}
          </span>
        </div>
      </div>

      {/* Quill 编辑区域 */}
      <div className="rich-title-container">
        <div ref={editorHostRef} className="rich-title-host" />
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
              （前端用户界面将以该样式混排展示）
            </span>
          </div>
          <div className="rich-title-preview-body">
            {!isRichTitleEmpty(sanitizedValue) ? (
              <span
                className="rich-title-render-content"
                dangerouslySetInnerHTML={{ __html: sanitizedValue }}
              />
            ) : (
              <Typography.Text type="secondary" italic>
                输入富文本内容后在此实时预览加粗、斜体与代币图标混排效果
              </Typography.Text>
            )}
          </div>
        </div>
      )}

      {/* 插入代币/图片弹窗 */}
      <Modal
        open={imageModalOpen}
        title="插入代币图标 / 图片"
        width={520}
        okText="插入到光标处"
        cancelText="取消"
        onOk={handleConfirmImage}
        onCancel={() => {
          setImageModalOpen(false);
          setImageUrl("");
          setImageAlt("");
          savedSelectionRef.current = null;
        }}
        okButtonProps={{ disabled: !/^https?:\/\//i.test(imageUrl.trim()) }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={14}>
          <Alert
            type="info"
            showIcon
            message="支持快捷选择主流代币 Logo，或直接输入自定义图片 URL（仅支持 https:// 图标地址）"
          />

          <div>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              快捷预设代币：
            </Typography.Text>
            <div className="preset-tokens-grid">
              {PRESET_TOKEN_ICONS.map((token) => (
                <Tag
                  key={token.name}
                  className={`preset-token-tag ${imageUrl === token.url ? "selected" : ""}`}
                  onClick={() => {
                    setImageUrl(token.url);
                    setImageAlt(token.name);
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
              图片地址 (URL)：
            </Typography.Text>
            <Input
              placeholder="https://...（支持 png/jpg/svg/webp）"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onPressEnter={handleConfirmImage}
              allowClear
            />
          </div>

          {imageUrl && /^https?:\/\//i.test(imageUrl.trim()) && (
            <Card size="small" title="图片实时预览" className="image-preview-card">
              <div className="image-preview-content">
                <span style={{ marginRight: 8 }}>标题混排效果：</span>
                <span className="preview-sample">
                  以太坊
                  <img
                    src={imageUrl.trim()}
                    alt={imageAlt || "preview"}
                    className="preview-sample-img"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  突破历史新高？
                </span>
              </div>
            </Card>
          )}
        </Space>
      </Modal>
    </div>
  );
}
