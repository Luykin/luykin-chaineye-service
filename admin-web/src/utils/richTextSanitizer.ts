const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "ul",
]);

const ALLOWED_CLASSES = new Set([
  "ql-size-small",
  "ql-size-large",
  "ql-size-huge",
  "ql-align-center",
  "ql-align-right",
  "ql-align-justify",
]);

const ALLOWED_STYLE_PROPS = new Set([
  "background-color",
  "color",
  "font-size",
  "font-style",
  "font-weight",
  "text-align",
  "text-decoration",
]);

function isSafeHref(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  if (
    normalized.startsWith("#") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return true;
  }
  try {
    const parsed = new URL(normalized, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeStyle(styleValue: string) {
  return styleValue
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const index = rule.indexOf(":");
      if (index === -1) return "";
      const prop = rule.slice(0, index).trim().toLowerCase();
      const value = rule.slice(index + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return "";
      if (!value || /expression\s*\(|url\s*\(|javascript:/i.test(value)) return "";
      if (!/^[#(),.%\-\s\w"]+$/i.test(value)) return "";
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeElement(doc: Document, element: Element): Node {
  const tag = element.tagName.toLowerCase();
  const fragment = doc.createDocumentFragment();

  Array.from(element.childNodes).forEach((child) => {
    fragment.appendChild(sanitizeNode(doc, child));
  });

  if (!ALLOWED_TAGS.has(tag)) {
    return fragment;
  }

  const clean = doc.createElement(tag);
  Array.from(element.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    const value = attr.value || "";

    if (name.startsWith("on")) return;

    if (name === "href" && tag === "a") {
      if (isSafeHref(value)) clean.setAttribute("href", value.trim());
      return;
    }

    if (name === "target" && tag === "a") {
      if (value === "_blank" || value === "_self") clean.setAttribute("target", value);
      return;
    }

    if (name === "title" && tag === "a") {
      clean.setAttribute("title", value.trim().slice(0, 255));
      return;
    }

    if (name === "class") {
      const classes = value
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => ALLOWED_CLASSES.has(item));
      if (classes.length) clean.setAttribute("class", classes.join(" "));
      return;
    }

    if (name === "style") {
      const sanitizedStyle = sanitizeStyle(value);
      if (sanitizedStyle) clean.setAttribute("style", sanitizedStyle);
      return;
    }
  });

  if (tag === "a" && clean.getAttribute("target") === "_blank") {
    clean.setAttribute("rel", "noopener noreferrer");
  }

  clean.appendChild(fragment);
  return clean;
}

function sanitizeNode(doc: Document, node: Node): Node {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return doc.createTextNode("");
  }
  return sanitizeElement(doc, node as Element);
}

export function sanitizeRichTextHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const wrapper = document.createElement("div");
  Array.from(template.content.childNodes).forEach((node) => {
    wrapper.appendChild(sanitizeNode(document, node));
  });
  return wrapper.innerHTML;
}
