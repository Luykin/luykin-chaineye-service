// @ts-nocheck
// Generated from legacy EJS inline script. Keep behavior 1:1; do not hand-rewrite unless migrating deliberately.
export function registerLegacyNacosMessages() {
  let inited = false;
  const DATA_IDS = { zh: "xhunt_message", en: "xhunt_message_en" };
  let currentLang = "zh";
  let currentIndex = -1;
  let items = [];
  let originalItems = null;
  let dirty = false;
  let editorMode = null;
  let quill = null;

  const DEFAULT_FOOTER_HTML = `<br>请加入我们的<a href='https://t.me/xhunt_ai' target='_blank' style='color:rgb(29, 155, 240)'>电报群</a>获取最新资讯。`;

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    const el = $("nacos-msg-toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    el.style.background = type === "error" ? "#991b1b" : type === "success" ? "#065f46" : "#111827";
    setTimeout(() => { el.style.display = "none"; }, 2400);
  }

  function fmtTs(ts) {
    const n = Number(ts);
    if (!n) return "-";
    try {
      return new Date(n).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    } catch (e) { return String(ts); }
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s == null ? "" : String(s);
    return div.innerHTML;
  }

  function isEditorEnabled() { return currentIndex >= 0 && !!items[currentIndex]; }

  // HTML 源码编辑
  function showHtmlModal() {
    const modal = $("nacos-html-modal");
    const textarea = $("nacos-html-source");
    if (!modal || !textarea) return;
    textarea.value = getEditorHtml();
    modal.style.display = "flex";
    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);
  }

  function hideHtmlModal() {
    const modal = $("nacos-html-modal");
    if (modal) modal.style.display = "none";
  }

  function saveHtmlFromModal() {
    const textarea = $("nacos-html-source");
    if (!textarea) return;
    const newHtml = textarea.value || "";
    const cleaned = removeBlackColors(newHtml);
    setEditorHtml(cleaned);
    syncToModel();
    hideHtmlModal();
  }

  function removeBlackColors(html) {
    if (!html || typeof html !== "string") return html;
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const blackPatterns = [/^#000000$/i, /^#000$/i, /^rgb\s*\(\s*0\s*,\s*0\s*,\s*0\s*\)$/i, /^rgba\s*\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[01](?:\.\d+)?\s*\)$/i, /^black$/i];
    function isBlack(c) { return c && blackPatterns.some(p => p.test(c.trim())); }
    temp.querySelectorAll("*").forEach(el => {
      const style = el.getAttribute("style");
      if (!style) return;
      const styles = style.split(";").filter(s => s.trim());
      const newStyles = [];
      styles.forEach(rule => {
        const match = rule.match(/^\s*([^:]+)\s*:\s*(.+)\s*$/);
        if (!match) { newStyles.push(rule); return; }
        const [, prop, value] = match;
        if (prop.trim().toLowerCase() === "color" && isBlack(value)) return;
        newStyles.push(rule);
      });
      if (newStyles.length > 0) el.setAttribute("style", newStyles.join("; "));
      else el.removeAttribute("style");
    });
    return temp.innerHTML;
  }

  function getEditorHtml() {
    let html = "";
    if (editorMode === "quill" && quill) html = quill.root.innerHTML || "";
    else html = $("nacos-msg-content-fallback").innerHTML || "";
    return removeBlackColors(html);
  }

  function setEditorHtml(html) {
    const cleaned = removeBlackColors(html || "");
    if (editorMode === "quill" && quill) {
      quill.clipboard.dangerouslyPasteHTML(cleaned);
      return;
    }
    $("nacos-msg-content-fallback").innerHTML = cleaned;
  }

  function setEditorEnabled(enabled) {
    if (editorMode === "quill" && quill) {
      quill.enable(!!enabled);
      $("nacos-quill-toolbar").style.display = enabled ? "block" : "none";
      $("nacos-msg-content").style.display = enabled ? "block" : "none";
      $("nacos-rte-toolbar").style.display = "none";
      $("nacos-msg-content-fallback").style.display = "none";
      return;
    }
    $("nacos-rte-toolbar").style.display = "flex";
    $("nacos-msg-content-fallback").style.display = "block";
    $("nacos-quill-toolbar").style.display = "none";
    $("nacos-msg-content").style.display = "none";
    const editor = $("nacos-msg-content-fallback");
    editor.setAttribute("contenteditable", enabled ? "true" : "false");
    ["nacos-rte-bold", "nacos-rte-italic", "nacos-rte-underline", "nacos-rte-br", "nacos-rte-link", "nacos-rte-unlink"].forEach(id => {
      const btn = $(id);
      if (btn) btn.disabled = !enabled;
    });
  }

  function setControlsEnabled(enabled) {
    $("nacos-msg-title").disabled = !enabled;
    $("nacos-msg-type").disabled = !enabled;
    $("nacos-msg-delete").disabled = !enabled;
    $("nacos-msg-publish").disabled = !enabled;
    setEditorEnabled(enabled);
  }

  function syncToModel() {
    if (!isEditorEnabled()) return;
    const html = getEditorHtml();
    items[currentIndex] = { ...items[currentIndex], title: $("nacos-msg-title").value, type: $("nacos-msg-type").value || "all", content: html };
    $("nacos-msg-preview").innerHTML = html || "";
    dirty = true;
    renderList();
  }

  function renderList() {
    const listEl = $("nacos-msg-list");
    const countEl = $("nacos-msg-count");
    if (!listEl) return;
    const sorted = [...items].sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
    listEl.innerHTML = sorted.map((it) => {
      const originalIndex = items.indexOf(it);
      const active = originalIndex === currentIndex ? "active" : "";
      return `
        <div class="nacos-msg-item ${active}" data-idx="${originalIndex}">
          <div class="msg-item-title">${escapeHtml(it.title || "(无标题)")}</div>
          <div class="msg-item-meta">${escapeHtml(fmtTs(it.created))}</div>
        </div>
      `;
    }).join("") || `<div class="empty-state">暂无公告，点击「新增公告」创建</div>`;
    if (countEl) countEl.textContent = `${items.length} 条`;
    listEl.querySelectorAll(".nacos-msg-item").forEach(node => {
      node.addEventListener("click", () => { selectItem(Number(node.getAttribute("data-idx"))); });
    });
  }

  function selectItem(idx) {
    currentIndex = idx;
    const it = items[idx];
    if (!it) {
      setControlsEnabled(false);
      $("nacos-msg-title").value = "";
      setEditorHtml("");
      $("nacos-msg-preview").innerHTML = "";
      $("nacos-msg-editor-hint").textContent = "选择左侧公告开始编辑";
      renderList();
      return;
    }
    setControlsEnabled(true);
    $("nacos-msg-title").value = it.title || "";
    $("nacos-msg-type").value = it.type || "all";
    setEditorHtml(it.content || "");
    $("nacos-msg-preview").innerHTML = it.content || "";
    $("nacos-msg-editor-hint").textContent = `正在编辑: ${it.created || ""}`;
    renderList();
  }

  function initEditor() {
    if (window.Quill) {
      editorMode = "quill";
      
      // 字号选项中文标签
      const sizeClasses = { small: "小", "": "正常", large: "大", huge: "特大" };
      
      // 颜色选项（去掉黑色系，避免主题冲突）
      const quillColors = [
        "#e60000", "#ff9900", "#ffff00", "#008a00", "#0066cc", "#9933ff", "rgb(29, 155, 240)", 
        "#facccc", "#ffebcc", "#ffffcc", "#cce8cc", "#cce0f5", "#ebd6ff",
        "#f06666", "#ffc266", "#ffff66", "#66b966", "#66a3e0", "#c285ff",
        "#a10000", "#b26b00", "#b2b200", "#006100", "#0047b2", "#6b24b2"
      ];
      
      // 自定义按钮图标
      const customIcons = {
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>',
        eyedropper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20.2 3.8l-2.5 2.5-1.4-1.4 2.5-2.5 1.4 1.4zM4 16l-1 5 5-1 9.5-9.5-4-4L4 16z"/></svg>',
        clean: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
      };
      
      const toolbarOptions = {
        container: [
          [{ size: ["small", false, "large", "huge"] }],  // 字号
          [{ color: quillColors }, { background: quillColors }],  // 文字色 + 背景色
          ["bold", "italic", "underline"],  // 格式
          ["link"],  // 链接
          ["clean"],  // 清除格式（重要！）
          ["html", "eyedropper"]  // 自定义按钮
        ],
        handlers: {
          html: function () { showHtmlModal(); },
          eyedropper: async function () {
            if (!window.EyeDropper) { toast("浏览器不支持 EyeDropper API", "error"); return; }
            try {
              const eyeDropper = new window.EyeDropper();
              const result = await eyeDropper.open();
              if (quill && result.sRGBHex) quill.format("color", result.sRGBHex);
            } catch (error) { if (error.name !== "AbortError") toast("颜色提取失败", "error"); }
          }
        }
      };
      
      quill = new window.Quill("#nacos-msg-content", {
        theme: "snow",
        modules: { 
          toolbar: toolbarOptions, 
          clipboard: { matchVisual: false }
        }
      });
      
      // 设置所有按钮的图标和 tooltip
      setTimeout(() => {
        // 自定义按钮图标
        const htmlBtn = document.querySelector(".ql-html");
        if (htmlBtn) { 
          htmlBtn.innerHTML = customIcons.html; 
          htmlBtn.title = "编辑HTML源码"; 
        }
        const eyeBtn = document.querySelector(".ql-eyedropper");
        if (eyeBtn) { 
          eyeBtn.innerHTML = customIcons.eyedropper; 
          eyeBtn.title = "屏幕拾色"; 
        }
        
        // 标准按钮 tooltip
        const boldBtn = document.querySelector(".ql-bold");
        if (boldBtn) boldBtn.title = "加粗 (Ctrl+B)";
        
        const italicBtn = document.querySelector(".ql-italic");
        if (italicBtn) italicBtn.title = "斜体 (Ctrl+I)";
        
        const underlineBtn = document.querySelector(".ql-underline");
        if (underlineBtn) underlineBtn.title = "下划线 (Ctrl+U)";
        
        const linkBtn = document.querySelector(".ql-link");
        if (linkBtn) linkBtn.title = "插入链接 (Ctrl+K)";
        
        const cleanBtn = document.querySelector(".ql-clean");
        if (cleanBtn) { 
          cleanBtn.innerHTML = "🧹 ";
          cleanBtn.title = "选中内容后点此清除颜色和格式，确保继承主题颜色"; 
        }
        
        // 字号下拉中文 + tooltip
        const sizePicker = document.querySelector(".ql-size");
        if (sizePicker) {
          const label = sizePicker.querySelector(".ql-picker-label");
          if (label) label.title = "字号大小";
        }
        document.querySelectorAll(".ql-size .ql-picker-label").forEach(el => {
          const val = el.dataset.value || "";
          el.setAttribute("data-label", sizeClasses[val] || "正常");
        });
        document.querySelectorAll(".ql-size .ql-picker-item").forEach(el => {
          const val = el.dataset.value || "";
          el.textContent = sizeClasses[val] || "正常";
        });
        
        // 颜色选择器的标题
        const colorPicker = document.querySelector(".ql-color");
        if (colorPicker) {
          const label = colorPicker.querySelector(".ql-picker-label");
          if (label) label.title = "文字颜色 - 建议尽量用默认，如需高亮可选亮色";
        }
        
        const bgPicker = document.querySelector(".ql-background");
        if (bgPicker) {
          const label = bgPicker.querySelector(".ql-picker-label");
          if (label) label.title = "背景高亮";
        }
      }, 100);
      
      quill.on("text-change", () => syncToModel());
      const root = quill.root;
      root.addEventListener("paste", (e) => {
        try {
          const cd = e.clipboardData;
          if (!cd) return;
          const html = cd.getData("text/html");
          const text = cd.getData("text/plain");
          const looksLikeHtml = (s) => typeof s === "string" && /<\/?[a-z][\s\S]*>/i.test(s);
          let toInsert = html && html.trim() ? html : looksLikeHtml(text) ? text : "";
          if (!toInsert) return;
          toInsert = removeBlackColors(toInsert);
          e.preventDefault();
          const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
          quill.clipboard.dangerouslyPasteHTML(range.index, toInsert, "user");
          quill.setSelection(range.index + 1, 0, "silent");
        } catch (err) { }
      });
      $("nacos-quill-toolbar").style.display = "none";
      $("nacos-msg-content").style.display = "none";
      $("nacos-rte-toolbar").style.display = "none";
      $("nacos-msg-content-fallback").style.display = "none";
      return;
    }
    // fallback
    editorMode = "fallback";
    $("nacos-rte-toolbar").style.display = "flex";
    $("nacos-msg-content-fallback").style.display = "block";
    $("nacos-quill-toolbar").style.display = "none";
    $("nacos-msg-content").style.display = "none";
    $("nacos-msg-content-fallback").addEventListener("input", () => syncToModel());
  }

  function switchLang(lang) {
    currentLang = lang;
    currentIndex = -1;
    items = [];
    originalItems = null;
    dirty = false;
    $("nacos-msg-dataid").textContent = DATA_IDS[lang];
    document.getElementById("nacos-msg-lang-zh").classList.toggle("active", lang === "zh");
    document.getElementById("nacos-msg-lang-en").classList.toggle("active", lang === "en");
    loadConfig();
    $("nacos-msg-title").value = "";
    setEditorHtml("");
    $("nacos-msg-preview").innerHTML = "";
    setControlsEnabled(false);
    $("nacos-msg-editor-hint").textContent = "选择左侧公告开始编辑";
  }

  async function loadConfig() {
    try {
      const resp = await fetch(`/api/xhunt/stats/nacos/config?dataId=${DATA_IDS[currentLang]}&group=DEFAULT_GROUP`);
      const result = await resp.json();
      if (result.success && result.data) {
        originalItems = JSON.parse(result.data.content || "[]");
        items = JSON.parse(result.data.content || "[]");
      } else {
        originalItems = [];
        items = [];
      }
      dirty = false;
      renderList();
    } catch (e) {
      toast("加载配置失败", "error");
    }
  }

  function newItem() {
    const newItem = { created: Date.now(), title: "", type: "all", content: DEFAULT_FOOTER_HTML };
    items.unshift(newItem);
    dirty = true;
    renderList();
    selectItem(0);
  }

  function deleteCurrent() {
    if (currentIndex < 0 || !items[currentIndex]) return;
    if (!confirm("确定删除这条公告？")) return;
    items.splice(currentIndex, 1);
    dirty = true;
    currentIndex = -1;
    renderList();
    selectItem(-1);
    toast("已删除，记得点击发布", "success");
  }

  function showPublishPreview() {
    const modal = $("nacos-msg-json-preview-modal");
    const pre = $("nacos-msg-json-preview-content");
    const dataidEl = $("nacos-msg-json-preview-dataid");
    const diffHint = $("nacos-msg-json-preview-diff-hint");
    if (!modal || !pre) return;
    dataidEl.textContent = DATA_IDS[currentLang];
    const newJson = JSON.stringify(items, null, 2);
    const oldJson = JSON.stringify(originalItems || [], null, 2);
    if (oldJson === newJson) {
      diffHint.textContent = "（无变更）";
      pre.textContent = newJson;
    } else {
      diffHint.textContent = `（${items.length - (originalItems || []).length > 0 ? "+" : ""}${items.length - (originalItems || []).length} 条）`;
      const diffHtml = Diff.createPatch("config.json", oldJson, newJson, "原始", "新");
      const lines = diffHtml.split("\n").slice(4);
      const formatted = lines.map(line => {
        if (line.startsWith("+")) return `<span class="added">${escapeHtml(line)}</span>`;
        if (line.startsWith("-")) return `<span class="removed">${escapeHtml(line)}</span>`;
        return escapeHtml(line);
      }).join("\n");
      pre.innerHTML = formatted;
    }
    modal.style.display = "flex";
  }

  async function doPublish() {
    try {
      const resp = await fetch(`/api/xhunt/stats/nacos/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          dataId: DATA_IDS[currentLang],
          group: "DEFAULT_GROUP",
          content: JSON.stringify(items)
        })
      });
      const result = await resp.json();
      if (result.success) {
        originalItems = JSON.parse(JSON.stringify(items));
        dirty = false;
        toast("发布成功", "success");
        $("nacos-msg-json-preview-modal").style.display = "none";
      } else {
        toast(result.error || "发布失败", "error");
      }
    } catch (e) {
      toast("发布失败", "error");
    }
  }

  function init() {
    if (inited) return;
    inited = true;
    initEditor();
    loadConfig();
    $("nacos-msg-lang-zh").addEventListener("click", () => switchLang("zh"));
    $("nacos-msg-lang-en").addEventListener("click", () => switchLang("en"));
    $("nacos-msg-refresh").addEventListener("click", loadConfig);
    $("nacos-msg-new").addEventListener("click", newItem);
    $("nacos-msg-delete").addEventListener("click", deleteCurrent);
    $("nacos-msg-publish").addEventListener("click", showPublishPreview);
    $("nacos-msg-title").addEventListener("input", syncToModel);
    $("nacos-msg-type").addEventListener("change", syncToModel);
    // HTML modal
    $("nacos-html-modal-close").addEventListener("click", hideHtmlModal);
    $("nacos-html-modal-cancel").addEventListener("click", hideHtmlModal);
    $("nacos-html-modal-save").addEventListener("click", saveHtmlFromModal);
    $("nacos-html-source").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveHtmlFromModal();
      if (e.key === "Escape") hideHtmlModal();
    });
    // JSON preview modal
    $("nacos-msg-json-preview-modal-close").addEventListener("click", () => { $("nacos-msg-json-preview-modal").style.display = "none"; });
    $("nacos-msg-json-preview-modal-cancel").addEventListener("click", () => { $("nacos-msg-json-preview-modal").style.display = "none"; });
    $("nacos-msg-json-preview-modal-confirm").addEventListener("click", doPublish);
    // Fallback RTE
    const exec = (cmd, val) => { document.execCommand(cmd, false, val); syncToModel(); };
    $("nacos-rte-bold").addEventListener("click", () => exec("bold"));
    $("nacos-rte-italic").addEventListener("click", () => exec("italic"));
    $("nacos-rte-underline").addEventListener("click", () => exec("underline"));
    $("nacos-rte-br").addEventListener("click", () => exec("insertHTML", "<br>"));
    $("nacos-rte-link").addEventListener("click", () => {
      const url = prompt("输入链接 URL:");
      if (url) exec("createLink", url);
    });
    $("nacos-rte-unlink").addEventListener("click", () => exec("unlink"));
  }

  // Tab 激活时初始化
  document.addEventListener("stats-tab-activated", function (e) {
    if (e.detail && e.detail.tabId === "nacos-messages") init();
  });
}
