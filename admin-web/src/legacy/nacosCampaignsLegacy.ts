// @ts-nocheck
// Generated from legacy EJS inline script. Keep behavior 1:1; do not hand-rewrite unless migrating deliberately.
export function registerLegacyNacosCampaigns() {
    let inited = false;
    const DATA_ID = "xhunt_campaigns";
    const GROUP = "DEFAULT_GROUP";

    let config = { version: 3, campaigns: [] };
    let originalConfig = null; // 保存从 Nacos 加载的原始配置
    let currentIndex = -1;
    let dirty = false;
    let search = "";
    let jsonModalMode = "config"; // 'config' | 'campaign'
    let websiteConfigDirty = false;
    let websiteCampaignRecords = [];
    let currentSelectionType = "nacos";
    let currentWebsiteOnlyRecord = null;

    // Tag 颜色系定义（全局常量，供各函数使用）
    const TAG_COLOR_SCHEMES = [
      { value: "green", label: "绿色", className: "tag-green" },
      { value: "purple", label: "紫色", className: "tag-purple" },
      { value: "yellow", label: "黄色", className: "tag-yellow" },
      { value: "blue", label: "蓝色", className: "tag-blue" },
      { value: "gray", label: "灰色", className: "tag-gray" },
      { value: "gold", label: "金色", className: "tag-gold" },
      { value: "red", label: "红色", className: "tag-red" },
      { value: "pink", label: "粉色", className: "tag-pink" },
      { value: "cyan", label: "青色", className: "tag-cyan" },
      { value: "orange", label: "橙色", className: "tag-orange" },
    ];

    // Lucide Icons 可选列表（常用图标）
    const LUCIDE_ICONS = [
      { value: "FileText", label: "FileText 📄" },
      { value: "Gift", label: "Gift 🎁" },
      { value: "Trophy", label: "Trophy 🏆" },
      { value: "Users", label: "Users 👥" },
      { value: "Star", label: "Star ⭐" },
      { value: "Heart", label: "Heart ❤️" },
      { value: "Zap", label: "Zap ⚡" },
      { value: "Rocket", label: "Rocket 🚀" },
      { value: "Award", label: "Award 🏅" },
      { value: "Medal", label: "Medal 🥇" },
      { value: "Crown", label: "Crown 👑" },
      { value: "Sparkles", label: "Sparkles ✨" },
      { value: "Flame", label: "Flame 🔥" },
      { value: "Target", label: "Target 🎯" },
      { value: "TrendingUp", label: "TrendingUp 📈" },
      { value: "Coins", label: "Coins 🪙" },
      { value: "Wallet", label: "Wallet 👛" },
      { value: "Shield", label: "Shield 🛡️" },
      { value: "CheckCircle", label: "CheckCircle ✅" },
      { value: "Info", label: "Info ℹ️" },
      { value: "Bell", label: "Bell 🔔" },
      { value: "Clock", label: "Clock ⏰" },
      { value: "Calendar", label: "Calendar 📅" },
      { value: "Tag", label: "Tag 🏷️" },
      { value: "Bookmark", label: "Bookmark 🔖" },
      { value: "Flag", label: "Flag 🚩" },
      { value: "MapPin", label: "MapPin 📍" },
      { value: "Globe", label: "Globe 🌐" },
      { value: "Link", label: "Link 🔗" },
      { value: "Share2", label: "Share2 🔄" },
    ];

    function $(id) {
      return document.getElementById(id);
    }

    function toast(msg, type) {
      const el = $("campaigns-toast");
      if (!el) return;
      el.textContent = msg;
      el.style.display = "block";
      el.style.background =
        type === "error"
          ? "#991b1b"
          : type === "success"
          ? "#065f46"
          : "#111827";
      setTimeout(() => {
        el.style.display = "none";
      }, 2400);
    }

    function escapeHtml(s) {
      const div = document.createElement("div");
      div.textContent = s == null ? "" : String(s);
      return div.innerHTML;
    }

    function safeNumber(v, fallback) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }

    function normalizeConfig(obj) {
      const out = obj && typeof obj === "object" ? obj : {};
      if (!Array.isArray(out.campaigns)) out.campaigns = [];
      out.version = safeNumber(out.version, 3);
      return out;
    }

    function splitLinesToList(text) {
      if (!text) return [];
      return String(text)
        .split(/[\n,]/g)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    function listToLines(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return "";
      return arr.map((s) => String(s)).join("\n");
    }

    function toDatetimeLocal(isoZ) {
      if (!isoZ) return "";
      try {
        const d = new Date(isoZ);
        if (isNaN(d.getTime())) return "";
        const pad = (n) => String(n).padStart(2, "0");
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
      } catch (e) {
        return "";
      }
    }

    function fromDatetimeLocalToIsoZ(localValue) {
      if (!localValue) return "";
      try {
        const d = new Date(localValue);
        if (isNaN(d.getTime())) return "";
        return d.toISOString().replace(/\.\d{3}Z$/, "Z");
      } catch (e) {
        return "";
      }
    }

    function getCurrentCampaign() {
      return config.campaigns[currentIndex] || null;
    }


    function getCurrentWebsiteTarget() {
      if (currentSelectionType === "website_only") return currentWebsiteOnlyRecord;
      return getCurrentCampaign();
    }

    function getWebsiteConfigKey(recordLike) {
      if (!recordLike) return "";
      if (currentSelectionType === "website_only") {
        return recordLike.nacosCampaignId || recordLike.id || "";
      }
      return recordLike.id || recordLike.nacosCampaignId || "";
    }

    function setEditorMode(mode) {
      currentSelectionType = mode === "website_only" ? "website_only" : "nacos";
      const legacyInfoEl = $("campaigns-legacy-info");
      if (legacyInfoEl) legacyInfoEl.style.display = currentSelectionType === "website_only" ? "block" : "none";
      const body = $("campaigns-editor-body");
      if (!body) return;
      const websiteSections = Array.from(body.querySelectorAll(".campaigns-website-section"));
      const sections = body.querySelectorAll('.campaign-status-control, .field-row-basic, .campaign-options, .section');
      sections.forEach((node) => {
        if (websiteSections.includes(node)) {
          node.style.display = "";
          return;
        }
        node.style.display = currentSelectionType === "website_only" ? "none" : "";
      });
    }


    function confirmDiscardWebsiteConfigChanges() {
      if (!websiteConfigDirty) return true;
      return window.confirm("你当前有未保存的网站配置修改，继续操作会丢失这些修改。\n确认继续？");
    }

    async function apiGetConfig(dataId) {
      const resp = await fetch(
        `/api/xhunt/stats/nacos/config?dataId=${encodeURIComponent(
          dataId
        )}&group=${encodeURIComponent(GROUP)}`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || "加载失败");
      return json.data;
    }

    async function apiPublishConfig({ dataId, content, group }) {
      const resp = await fetch(`/api/xhunt/stats/nacos/config`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          dataId,
          group: group || GROUP,
          content,
          type: "json",
          source: "nacos-campaigns",
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || "发布失败");
      return json.data;
    }


    async function apiSyncWebsiteCampaigns(dryRun) {
      const resp = await fetch(`/api/xhunt/website/campaigns/internal/sync-from-nacos`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ dryRun: !!dryRun }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      return json;
    }

    async function apiGetWebsiteConfig(nacosCampaignId) {
      const resp = await fetch(`/api/xhunt/website/campaigns/internal/by-nacos-id/${encodeURIComponent(nacosCampaignId)}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      return json.data || null;
    }

    async function apiSaveWebsiteConfig(nacosCampaignId, payload) {
      const resp = await fetch(`/api/xhunt/website/campaigns/internal/${encodeURIComponent(nacosCampaignId)}/web-config`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      return json.data;
    }


    async function apiListAllWebsiteCampaigns() {
      const resp = await fetch(`/api/xhunt/website/campaigns/internal/list-all`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      return Array.isArray(json.data) ? json.data : [];
    }

    function getWebsiteConfigIds() {
      return [
        "campaigns-webStatus",
        "campaigns-website-slug",
        "campaigns-pageTemplate",
        "campaigns-webAnnouncementZh",
        "campaigns-webAnnouncementEn",
        "campaigns-webRewardTextZh",
        "campaigns-webRewardTextEn",
        "campaigns-webNoteZh",
        "campaigns-webNoteEn",
        "campaigns-listLeftLogo",
        "campaigns-listRightLogo",
        "campaigns-listChestImage",
        "campaigns-claimPoiContractAddress",
        "campaigns-claimPowContractAddress",
        "campaigns-claimEssayContractAddress",
        "campaigns-templateConfig",
      ];
    }

    function setTemplateConfigStatus(message, type) {
      const el = $("campaigns-templateConfig-status");
      if (!el) return;
      el.textContent = `JSON 状态：${message || "未检查"}`;
      el.style.color =
        type === "error" ? "#dc2626" :
        type === "success" ? "#059669" :
        type === "info" ? "#2563eb" :
        "#6b7280";
    }

    function parseTemplateConfigFromEditor() {
      const raw = $("campaigns-templateConfig").value.trim();
      if (!raw) {
        setTemplateConfigStatus("为空，将按 {} 保存", "info");
        return {};
      }
      try {
        const parsed = JSON.parse(raw);
        setTemplateConfigStatus("格式合法", "success");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        setTemplateConfigStatus(`格式错误：${e.message}`, "error");
        throw new Error("templateConfig 不是合法 JSON");
      }
    }

    function formatTemplateConfigEditor() {
      const parsed = parseTemplateConfigFromEditor();
      $("campaigns-templateConfig").value = JSON.stringify(parsed, null, 2);
      setTemplateConfigStatus("已格式化且格式合法", "success");
      websiteConfigDirty = true;
      const saveBtn = $("campaigns-save-website");
      if (saveBtn) saveBtn.disabled = false;
    }

    function setWebsiteControlsEnabled(enabled) {
      getWebsiteConfigIds().forEach((id) => {
        const el = $(id);
        if (el) el.disabled = !enabled;
      });
      const saveBtn = $("campaigns-save-website");
      if (saveBtn) saveBtn.disabled = !enabled;
    }

    function clearWebsiteConfigEditor(message) {
      getWebsiteConfigIds().forEach((id) => {
        const el = $(id);
        if (!el) return;
        if (el.tagName === "SELECT") {
          if (id === "campaigns-webStatus") el.value = "draft";
        } else if (el.type === "checkbox") {
          el.checked = false;
        } else {
          el.value = "";
        }
      });
      const templateConfigEl = $("campaigns-templateConfig");
      if (templateConfigEl) templateConfigEl.value = "{}";
      setTemplateConfigStatus("未检查", "default");
      const metaEl = $("campaigns-website-meta");
      if (metaEl) metaEl.textContent = message || "尚未加载网站配置";
      websiteConfigDirty = false;
      setWebsiteControlsEnabled(false);
      const saveBtn = $("campaigns-save-website");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "请先同步到网站";
      }
    }

    function syncWebsiteRecordCache(record) {
      if (!record || !(record.nacosCampaignId || record.id)) return;
      const key = String(record.nacosCampaignId || record.id);
      const next = Array.isArray(websiteCampaignRecords) ? websiteCampaignRecords.slice() : [];
      const idx = next.findIndex((item) => String(item.nacosCampaignId || item.id) === key);
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...record };
      } else {
        next.push(record);
      }
      websiteCampaignRecords = next;
      if (currentSelectionType === "website_only" && currentWebsiteOnlyRecord && String(currentWebsiteOnlyRecord.nacosCampaignId || currentWebsiteOnlyRecord.id) === key) {
        currentWebsiteOnlyRecord = { ...currentWebsiteOnlyRecord, ...record };
      }
    }

    function renderWebsiteMeta(record) {
      const metaEl = $("campaigns-website-meta");
      if (!metaEl) return;
      if (!record) {
        metaEl.textContent = "该活动尚未同步到网站数据库，请先点击“同步到网站”";
        return;
      }
      const updatedAt = record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "-";
      const syncedAt = record.lastSyncedAt ? new Date(record.lastSyncedAt).toLocaleString() : "-";
      const deletedText = record.isDeleted ? "｜已软删除" : "";
      metaEl.textContent = `网站记录已存在｜状态：${record.webStatus || "draft"}｜最后同步：${syncedAt}｜最后修改：${updatedAt}${deletedText}`;
    }

    function renderClaimRequirements() {
      const c = getCurrentWebsiteTarget() || {};
      const nacosPayload = c.nacosPayload && typeof c.nacosPayload === "object" ? c.nacosPayload : {};
      const status = $("campaigns-webStatus") ? $("campaigns-webStatus").value : "draft";
      const claimHintEl = $("campaigns-claim-hint");
      const powFieldEl = $("campaigns-claim-pow-field");
      const essayFieldEl = $("campaigns-claim-essay-field");
      const powEnabled = !!(c.enablePowLeaderboard === true || nacosPayload.enablePowLeaderboard === true);
      const essayEnabled = !!(c.enableEssayContest === true || nacosPayload.enableEssayContest === true);
      if (powFieldEl) powFieldEl.style.display = powEnabled ? "block" : "none";
      if (essayFieldEl) essayFieldEl.style.display = essayEnabled ? "block" : "none";
      if (claimHintEl) {
        const parts = [];
        if (status === "claim") {
          parts.push("当前网站状态为 claim，POI 合约地址必填");
          parts.push(powEnabled ? "当前活动已开启 POW，POW 合约地址必填" : "当前活动未开启 POW，POW 合约地址可留空");
          parts.push(essayEnabled ? "当前活动已开启征文大赛，征文合约地址必填" : "当前活动未开启征文大赛，征文合约地址可留空");
        } else {
          parts.push("当前不是领奖中状态，可先留空，等领奖合约部署后再回来配置");
          parts.push("切换为 claim 状态后，系统会按活动配置校验必填项");
          parts.push(powEnabled ? "当前活动已开启 POW，可提前配置 POW 合约地址" : "当前活动未开启 POW，所以不需要配置 POW 合约地址");
          parts.push(essayEnabled ? "当前活动已开启征文大赛，可提前配置征文合约地址" : "当前活动未开启征文大赛，所以不需要配置征文合约地址");
        }
        claimHintEl.textContent = parts.join("；");
      }
    }

    function toggleClaimConfigByStatus() {
      renderClaimRequirements();
    }

    const DEFAULT_WEBSITE_LIST_LEFT_LOGO = "https://xhunt.ai/whitexhunt.png";
    const DEFAULT_WEBSITE_LIST_RIGHT_LOGO = "https://xhunt.ai/whitexhunt.png";
    const DEFAULT_WEBSITE_LIST_CHEST_IMAGE = "https://xhunt.ai/usdc2.png";

    function getWebsiteListAssets(record, campaign) {
      const websiteExtra = record && record.websiteExtra && typeof record.websiteExtra === "object" ? record.websiteExtra : {};
      const listAssets = websiteExtra.listAssets && typeof websiteExtra.listAssets === "object" ? websiteExtra.listAssets : {};
      return {
        leftLogo: listAssets.leftLogo || DEFAULT_WEBSITE_LIST_LEFT_LOGO,
        rightLogo: listAssets.rightLogo || DEFAULT_WEBSITE_LIST_RIGHT_LOGO,
        chestImage: listAssets.chestImage || DEFAULT_WEBSITE_LIST_CHEST_IMAGE,
      };
    }

    function fillWebsiteConfigForm(record, campaign) {
      const listAssets = getWebsiteListAssets(record, campaign);
      $("campaigns-webStatus").value = (record && record.webStatus) || "draft";
      $("campaigns-website-slug").value = (record && record.slug) || (campaign && (campaign.campaignKey || "")) || "";
      $("campaigns-pageTemplate").value = (record && record.pageTemplate) || "standard";
      $("campaigns-webAnnouncementZh").value = (record && record.webAnnouncementZh) || "";
      $("campaigns-webAnnouncementEn").value = (record && record.webAnnouncementEn) || "";
      $("campaigns-webRewardTextZh").value = (record && record.webRewardTextZh) || "";
      $("campaigns-webRewardTextEn").value = (record && record.webRewardTextEn) || "";
      $("campaigns-webNoteZh").value = (record && record.webNoteZh) || "";
      $("campaigns-webNoteEn").value = (record && record.webNoteEn) || "";
      $("campaigns-listLeftLogo").value = listAssets.leftLogo;
      $("campaigns-listRightLogo").value = listAssets.rightLogo;
      $("campaigns-listChestImage").value = listAssets.chestImage;
      $("campaigns-claimPoiContractAddress").value = (record && record.claimPoiContractAddress) || "";
      $("campaigns-claimPowContractAddress").value = (record && record.claimPowContractAddress) || "";
      $("campaigns-claimEssayContractAddress").value = (record && record.claimEssayContractAddress) || "";
      $("campaigns-templateConfig").value = JSON.stringify((record && record.templateConfig) || {}, null, 2);
      renderClaimRequirements();
      renderWebsiteMeta(record);
      websiteConfigDirty = false;
      setWebsiteControlsEnabled(!!campaign && !!(campaign.id || campaign.nacosCampaignId));
      const saveBtn = $("campaigns-save-website");
      if (saveBtn) saveBtn.textContent = "保存网站配置";
    }

    async function loadWebsiteConfigForCurrentCampaign() {
      const c = getCurrentWebsiteTarget();
      const websiteConfigKey = getWebsiteConfigKey(c);
      if (!websiteConfigKey) {
        clearWebsiteConfigEditor("请先选择活动");
        return;
      }
      setWebsiteControlsEnabled(true);
      renderWebsiteMeta(null);
      try {
        const record = await apiGetWebsiteConfig(websiteConfigKey);
        if (!record) {
          clearWebsiteConfigEditor("该活动尚未同步到网站数据库，请先点击“同步到网站”");
          return;
        }
        syncWebsiteRecordCache(record);
        fillWebsiteConfigForm(record, c);
      } catch (e) {
        clearWebsiteConfigEditor("加载网站配置失败：" + (e.message || "未知错误"));
      }
    }

    function collectWebsiteConfigPayload() {
      const templateConfig = parseTemplateConfigFromEditor();
      const c = getCurrentWebsiteTarget() || {};
      const nacosPayload = c.nacosPayload && typeof c.nacosPayload === "object" ? c.nacosPayload : {};
      const nextStatus = $("campaigns-webStatus").value;
      const poi = $("campaigns-claimPoiContractAddress").value.trim();
      const pow = $("campaigns-claimPowContractAddress").value.trim();
      const essay = $("campaigns-claimEssayContractAddress").value.trim();
      if (nextStatus === "claim") {
        if (!poi) throw new Error("claim 状态下必须填写 POI 合约地址");
        if ((c.enablePowLeaderboard || nacosPayload.enablePowLeaderboard) && !pow) throw new Error("当前活动已开启 POW，claim 状态下必须填写 POW 合约地址");
        if ((c.enableEssayContest || nacosPayload.enableEssayContest) && !essay) throw new Error("当前活动已开启征文大赛，claim 状态下必须填写征文大赛合约地址");
      }
      return {
        slug: $("campaigns-website-slug").value.trim(),
        webStatus: $("campaigns-webStatus").value,
        webAnnouncementZh: $("campaigns-webAnnouncementZh").value,
        webAnnouncementEn: $("campaigns-webAnnouncementEn").value,
        webRewardTextZh: $("campaigns-webRewardTextZh").value,
        webRewardTextEn: $("campaigns-webRewardTextEn").value,
        webNoteZh: $("campaigns-webNoteZh").value,
        webNoteEn: $("campaigns-webNoteEn").value,
        claimPoiContractAddress: $("campaigns-claimPoiContractAddress").value,
        claimPowContractAddress: $("campaigns-claimPowContractAddress").value,
        claimEssayContractAddress: $("campaigns-claimEssayContractAddress").value,
        pageTemplate: $("campaigns-pageTemplate").value.trim() || "standard",
        templateConfig,
        websiteExtra: {
          listAssets: {
            leftLogo: $("campaigns-listLeftLogo").value.trim(),
            rightLogo: $("campaigns-listRightLogo").value.trim(),
            chestImage: $("campaigns-listChestImage").value.trim(),
          },
        },
      };
    }

    async function saveWebsiteConfig() {
      const c = getCurrentWebsiteTarget();
      const websiteConfigKey = getWebsiteConfigKey(c);
      if (!websiteConfigKey) throw new Error("请先选择已保存活动并同步到网站");
      const payload = collectWebsiteConfigPayload();
      const saved = await apiSaveWebsiteConfig(websiteConfigKey, payload);
      websiteConfigDirty = false;
      const record = await apiGetWebsiteConfig(websiteConfigKey);
      syncWebsiteRecordCache(record);
      fillWebsiteConfigForm(record, c);
      renderList();
      return saved;
    }

    function isEditorEnabled() {
      return currentIndex >= 0 && !!getCurrentCampaign();
    }

    function setControlsEnabled(enabled) {
      $("campaigns-duplicate").disabled = !enabled;
      $("campaigns-delete").disabled = !enabled;
      $("campaigns-logos-add").disabled = !enabled;
      $("campaigns-tasks-add").disabled = !enabled;
      const tagsAddBtn = $("campaigns-tags-add");
      if (tagsAddBtn) {
        tagsAddBtn.disabled = !enabled;
      }
      const essayWinnersAddBtn = $("campaigns-essay-winners-add");
      if (essayWinnersAddBtn) {
        essayWinnersAddBtn.disabled = !enabled;
      }
      const writingThemesAddBtn = $("campaigns-writing-themes-add");
      if (writingThemesAddBtn) {
        writingThemesAddBtn.disabled = !enabled;
      }
      setEditorInputsEnabled(enabled);
      var canToggleTestingPhase = enabled && (typeof window.__adminEmail === "string" && window.__adminEmail === "luo530366891@gmail.com");
      var enabledEl = $("campaigns-enabled");
      var testingPhaseEl = $("campaigns-testingPhase");
      if (enabledEl) enabledEl.disabled = !enabled;
      if (testingPhaseEl) testingPhaseEl.disabled = !canToggleTestingPhase;
    }

    function setEditorInputsEnabled(enabled) {
      const ids = [
        "campaigns-twitter-handle",
        "campaigns-sortWeight",
        "campaigns-displayName-zh",
        "campaigns-displayName-en",
        "campaigns-startAt",
        "campaigns-endAt",
        "campaigns-rewardAmount",
        "campaigns-rewardParticipantCount",
        "campaigns-rewardDistributionType",
        "campaigns-rewardUnit",
        "campaigns-enableEssayContest",
        "campaigns-essayContestAmount",
        "campaigns-essayContestWinnerCount",
        "campaigns-essayContestUnit",
        "campaigns-enablePowLeaderboard",
        "campaigns-powAmount",
        "campaigns-powWinnerCount",
        "campaigns-powDistributionType",
        "campaigns-powUnit",
        "campaigns-threshold",
        "campaigns-hasRiskConfirm",
        "campaigns-showSponsoredPolicy",
        "campaigns-copy-emoji",
        "campaigns-copy-ctaText-zh",
        "campaigns-copy-ctaText-en",
        "campaigns-copy-shortTitle-zh",
        "campaigns-copy-shortTitle-en",
        "campaigns-copy-goToOfficialText-zh",
        "campaigns-copy-goToOfficialText-en",
        "campaigns-copy-viewGuideText-zh",
        "campaigns-copy-viewGuideText-en",
        "campaigns-links-guideUrl",
        "campaigns-links-activeUrl",
        "campaigns-links-showLeaderboardLink",
        "campaigns-projectIntroduction-zh",
        "campaigns-projectIntroduction-en",
        "campaigns-testList",
        "campaigns-targetUserIds",
      ];
      ids.forEach((id) => {
        const el = $(id);
        if (el) el.disabled = !enabled;
      });
    }

    function setByPath(obj, path, value) {
      const parts = String(path).split(".");
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
    }

    function renderList() {
      const listEl = $("campaigns-list");
      const countEl = $("campaigns-count");
      if (!listEl) return;

      const campaigns = Array.isArray(config.campaigns) ? config.campaigns : [];
      const q = String(search || "").trim().toLowerCase();

      const nacosItems = campaigns
        .map((c, idx) => ({ c, idx, type: "nacos" }))
        .filter(({ c }) => {
          if (!q) return true;
          const hay = [c?.id, c?.campaignKey, c?.displayName?.zh, c?.displayName?.en, c?.copy?.title?.zh, c?.copy?.title?.en]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
        .sort((a, b) => {
          const wa = Number(a.c?.sortWeight) || 0;
          const wb = Number(b.c?.sortWeight) || 0;
          if (wa !== wb) return wb - wa;
          const ea = a.c?.enabled ? 1 : 0;
          const eb = b.c?.enabled ? 1 : 0;
          if (ea !== eb) return eb - ea;
          const sa = Date.parse(a.c?.enrollmentWindow?.startAt || "") || 0;
          const sb = Date.parse(b.c?.enrollmentWindow?.startAt || "") || 0;
          return sb - sa;
        });

      const websiteOnlyItems = (websiteCampaignRecords || [])
        .filter((item) => item && item.isDeleted)
        .filter((item) => {
          if (!q) return true;
          const hay = [item.nacosCampaignId, item.campaignKey, item.slug, item.displayNameZh, item.displayNameEn, item.webAnnouncementZh, item.webAnnouncementEn]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
        .sort((a, b) => Number(b.sortWeight || 0) - Number(a.sortWeight || 0));

      function renderGroup(title, html, emptyText) {
        return `
          <div class="list-group">
            <div class="list-group-title">${title}</div>
            ${html || `<div class="list-group-empty">${emptyText}</div>`}
          </div>
        `;
      }

      const nacosHtml = nacosItems.map(({ c, idx }) => {
        const active = currentSelectionType === "nacos" && idx === currentIndex ? "active" : "";
        const title = c?.displayName?.zh || c?.displayName?.en || c?.copy?.title?.zh || c?.id || "(未命名)";
        const weightNum = typeof c?.sortWeight === "number" && Number.isFinite(c.sortWeight) ? c.sortWeight : 0;
        const chips = [
          `<span class="chip chip-weight" title="排序权重，越大越靠前">${weightNum}</span>`,
          c?.enabled ? `<span class="chip on">enabled</span>` : `<span class="chip">disabled</span>`,
          c?.testingPhase ? `<span class="chip testing">testing</span>` : "",
        ].filter(Boolean);
        return `
          <div class="item ${active}" data-type="nacos" data-idx="${idx}">
            <div class="item-content">
              <div class="item-title-wrapper">
                <div class="item-title">
                  <span class="item-title-text">${escapeHtml(title)}</span>
                  <span class="chips">${chips.join("")}</span>
                </div>
              </div>
            </div>
          </div>`;
      }).join("");

      const websiteOnlyHtml = websiteOnlyItems.map((item) => {
        const active = currentSelectionType === "website_only" && currentWebsiteOnlyRecord && currentWebsiteOnlyRecord.nacosCampaignId === item.nacosCampaignId ? "active" : "";
        const title = item.displayNameZh || item.displayNameEn || item.campaignKey || item.slug || item.nacosCampaignId || "(未命名)";
        const chips = [
          `<span class="chip" title="插件已下架，仅网站展示">site-only</span>`,
          `<span class="chip chip-weight" title="排序权重">${Number(item.sortWeight || 0)}</span>`,
          item.webStatus ? `<span class="chip testing">${escapeHtml(item.webStatus)}</span>` : "",
        ].filter(Boolean);
        return `
          <div class="item ${active}" data-type="website_only" data-nacos-id="${escapeHtml(item.nacosCampaignId)}">
            <div class="item-content">
              <div class="item-title-wrapper">
                <div class="item-title">
                  <span class="item-title-text">${escapeHtml(title)}</span>
                  <span class="chips">${chips.join("")}</span>
                </div>
              </div>
            </div>
          </div>`;
      }).join("");

      listEl.innerHTML =
        renderGroup("Nacos 当前活动", nacosHtml, "暂无 Nacos 活动") +
        renderGroup("网页独有数据 <span title=\"插件已下架，仅供网站展示\">ℹ️</span>", websiteOnlyHtml, "暂无网页独有数据");

      const totalCount = nacosItems.length + websiteOnlyItems.length;
      if (countEl) countEl.textContent = `${totalCount} 个`;

      listEl.querySelectorAll('.item[data-type="nacos"]').forEach((node) => {
        node.addEventListener("click", () => {
          const idx = Number(node.getAttribute("data-idx"));
          selectCampaign(idx);
        });
      });
      listEl.querySelectorAll('.item[data-type="website_only"]').forEach((node) => {
        node.addEventListener("click", () => {
          const nacosId = node.getAttribute("data-nacos-id");
          selectWebsiteOnlyRecord(nacosId);
        });
      });
    }

    /**
     * 只更新当前活动在左侧列表中的标题和状态，不动头像 DOM，
     * 避免在编辑右侧表单时重复触发头像重新加载。
     */
    function updateListItemForCampaign(c, idx) {
      const listEl = $("campaigns-list");
      if (!listEl || !c || typeof idx !== "number" || idx < 0) return;
      const item = listEl.querySelector(`.item[data-idx="${idx}"]`);
      if (!item) return;

      // 更新 active 状态
      listEl.querySelectorAll(".item").forEach((node) => {
        if (Number(node.getAttribute("data-idx")) === idx) {
          node.classList.add("active");
        } else {
          node.classList.remove("active");
        }
      });

      const title =
        (c.displayName && (c.displayName.zh || c.displayName.en)) ||
        (c.copy && c.copy.title && (c.copy.title.zh || c.copy.title.en)) ||
        c.id ||
        "(未命名)";

      const titleSpan = item.querySelector(".item-title-text");
      if (titleSpan) {
        titleSpan.textContent = title;
      }

      const chipsContainer = item.querySelector(".chips");
      if (chipsContainer) {
        const weightNum = typeof c.sortWeight === "number" && Number.isFinite(c.sortWeight) ? c.sortWeight : 0;
        const chips = [
          `<span class="chip chip-weight" title="排序权重">${weightNum}</span>`,
          c.enabled ? `<span class="chip on">enabled</span>` : `<span class="chip">disabled</span>`,
          c.testingPhase ? `<span class="chip testing">testing</span>` : "",
        ].filter(Boolean);
        chipsContainer.innerHTML = chips.join("");
      }
    }

    function renderRepeaters() {
      const c = getCurrentCampaign();
      const logosEl = $("campaigns-logos");
      const tasksEl = $("campaigns-tasks");
      const winnersEl = $("campaigns-essay-winners");
      const tagsEl = $("campaigns-tags");
      if (!logosEl || !tasksEl) return;

      const logos = Array.isArray(c?.logos) ? c.logos : [];
      const tasks = Array.isArray(c?.tasks) ? c.tasks : [];
      const winners = Array.isArray(c?.essayContestWinners) ? c.essayContestWinners : [];
      const tags = Array.isArray(c?.tags) ? c.tags : [];
      
      // 确保所有 logo 都有默认的 ringClassName
      const defaultRingClassName = "ring-blue-400/20 hover:ring-blue-400/50";
      logos.forEach((logo) => {
        if (!logo.ringClassName || logo.ringClassName.trim() === "") {
          logo.ringClassName = defaultRingClassName;
        }
      });

      // 为每个 task 自动生成 id（如果没有的话）
      const campaignKey = c?.campaignKey || "";
      tasks.forEach((task) => {
        if (!task.id || !task.id.trim()) {
          const type = task?.type || "twitter";
          // 对于 custom 类型，强制使用 https:// 作为 url
          const url = type === "custom" ? "https://" : (task?.url || "");
          if (campaignKey && type && url) {
            task.id = generateTaskId(campaignKey, type, url);
          }
        }
      });

      // 确保所有 tag 都有默认值
      tags.forEach((tag) => {
        if (!tag.colorScheme || !tag.colorScheme.trim()) {
          tag.colorScheme = "blue";
        }
        if (!tag.icon || !tag.icon.trim()) {
          tag.icon = "Tag";
        }
      });

      logosEl.innerHTML =
        logos
          .map((it, i) => {
            return `
              <div class="rep-card" data-kind="logos" data-index="${i}">
                <div class="rep-header">
                  <div class="rep-title">#${i + 1} Logo</div>
                  <div class="rep-actions">
                    <button class="btn" type="button" data-action="up">←</button>
                    <button class="btn" type="button" data-action="down">→</button>
                    <button class="btn danger" type="button" data-action="remove">删除</button>
                  </div>
                </div>
                <div class="field-row">
                  <div class="field">
                    <label>图片（必填）</label>
                    <input type="text" data-field="image" value="${escapeHtml(
                      it?.image || ""
                    )}" />
                  </div>
                  <div class="field">
                    <label>推特链接（必填）</label>
                    <input type="text" data-field="url" value="${escapeHtml(
                      it?.url || ""
                    )}" />
                  </div>
                  <div class="field">
                    <label>推特账号（必填）</label>
                    <input type="text" data-field="label" value="${escapeHtml(
                      it?.label || ""
                    )}" />
                  </div>
                </div>
              </div>
            `;
          })
          .join("") || `<div class="muted">暂无 logos，可点击上方“添加 Logo”。</div>`;

      tasksEl.innerHTML =
        tasks
          .map((it, i) => {
            const type = it?.type || "twitter";
            // 如果是 custom 类型，强制设置 url 和 autoComplete
            const isCustom = type === "custom";
            const url = isCustom ? "https://" : (it?.url || "");
            const auto = isCustom ? false : !!it?.autoComplete;
            return `
              <div class="rep-card task-card" data-kind="tasks" data-index="${i}">
                <div class="rep-header">
                  <div class="rep-title">#${i + 1} Task</div>
                  <div class="rep-actions">
                    <button class="btn" type="button" data-action="up">←</button>
                    <button class="btn" type="button" data-action="down">→</button>
                    <button class="btn danger" type="button" data-action="remove">删除</button>
                  </div>
                </div>

                <div class="task-grid">
                  <!-- 第一行：ID + Type -->
                  <div class="task-field task-field-id">
                    <label>ID <span class="task-label-note">自动生成</span></label>
                    <input type="text" data-field="id" value="${escapeHtml(
                      it?.id || ""
                    )}" disabled class="task-input-id" />
                  </div>
                  
                  <div class="task-field task-field-type">
                    <label>Type</label>
                    <select data-field="type" class="task-type-select task-select">
                      <option value="twitter" ${
                        type === "twitter" ? "selected" : ""
                      }>twitter</option>
                      <option value="telegram" ${
                        type === "telegram" ? "selected" : ""
                      }>telegram</option>
                      <option value="other" ${
                        type === "other" ? "selected" : ""
                      }>other</option>
                      <option value="custom" ${
                        type === "custom" ? "selected" : ""
                      }>backend-custom</option>
                    </select>
                  </div>

                  <!-- 第二行：AutoComplete 开关 -->
                  <div class="task-field task-field-autocomplete ${isCustom ? 'is-disabled' : ''}">
                    <label>Auto Complete</label>
                    <div class="task-autocomplete-wrapper">
                      <label class="switch">
                        <input type="checkbox" data-field="autoComplete" ${
                          auto ? "checked" : ""
                        } class="task-autocomplete-checkbox" ${isCustom ? 'disabled' : ''} />
                        <span class="slider"></span>
                      </label>
                      <span class="task-autocomplete-hint">点击链接即完成任务</span>
                    </div>
                  </div>

                  <!-- 第三行：标题 -->
                  <div class="task-field task-field-title">
                    <label>任务标题（中文）</label>
                    <input type="text" data-field="title.zh" value="${escapeHtml(
                      it?.title?.zh || ""
                    )}" class="task-input" placeholder="输入中文标题..." />
                  </div>
                  
                  <div class="task-field task-field-title">
                    <label>任务标题（English）</label>
                    <input type="text" data-field="title.en" value="${escapeHtml(
                      it?.title?.en || ""
                    )}" class="task-input" placeholder="Enter English title..." />
                  </div>

                  <!-- 第四行：链接 -->
                  <div class="task-field task-field-url">
                    <label>跳转链接</label>
                    <input type="text" data-field="url" value="${escapeHtml(
                      url
                    )}" class="task-url-input task-input ${isCustom ? 'is-readonly' : ''}" ${isCustom ? 'readonly' : ''} placeholder="https://..." />
                  </div>
                </div>
              </div>
            `;
          })
          .join("") || `<div class="muted">暂无 tasks，可点击上方"添加 Task"。</div>`;

      // 渲染征文大赛获奖者（仅在开启征文大赛时显示）
      if (winnersEl) {
        winnersEl.innerHTML =
          winners
            .map((it, i) => {
              return `
                <div class="rep-card" data-kind="essay-winners" data-index="${i}">
                  <div class="rep-header">
                    <div class="rep-title">#${i + 1} 获奖者</div>
                    <div class="rep-actions">
                      <button class="btn" type="button" data-action="up">←</button>
                      <button class="btn" type="button" data-action="down">→</button>
                      <button class="btn danger" type="button" data-action="remove">删除</button>
                    </div>
                  </div>
                  <div class="field-row field-row-2">
                    <div class="field">
                      <label>姓名（name）</label>
                      <input type="text" data-field="name" value="${escapeHtml(
                        it?.name || ""
                      )}" />
                    </div>
                    <div class="field">
                      <label>推特账号（handler）</label>
                      <input type="text" data-field="handler" value="${escapeHtml(
                        it?.handler || ""
                      )}" />
                    </div>
                  </div>
                  <div class="field-row field-row-2">
                    <div class="field">
                      <label>头像地址（avatar）</label>
                      <input type="text" data-field="avatar" value="${escapeHtml(
                        it?.avatar || ""
                      )}" placeholder="https://..." />
                    </div>
                    <div class="field">
                      <label>奖励金额（reward）</label>
                      <input type="text" data-field="reward" value="${escapeHtml(
                        it?.reward || ""
                      )}" placeholder="例如：1000" />
                    </div>
                  </div>
                </div>
              `;
            })
            .join("") || `<div class="muted">暂无获奖者，可点击上方"添加获奖者"。</div>`;
      }

      // 写作相关主题（writingThemes：{ zh, en }[]，至少一项）
      const writingThemesEl = $("campaigns-writing-themes");
      if (writingThemesEl) {
        const themes = Array.isArray(c?.writingThemes) ? c.writingThemes : [{ zh: "", en: "" }];
        writingThemesEl.innerHTML =
          themes
            .map((item, i) => {
              const obj = item && typeof item === "object" ? item : { zh: typeof item === "string" ? item : "", en: "" };
              const zh = obj.zh != null ? String(obj.zh) : "";
              const en = obj.en != null ? String(obj.en) : "";
              return `
                <div class="rep-card" data-kind="writing-themes" data-index="${i}">
                  <div class="rep-header">
                    <div class="rep-title">主题 #${i + 1}</div>
                    <div class="rep-actions">
                      <button class="btn" type="button" data-action="up">←</button>
                      <button class="btn" type="button" data-action="down">→</button>
                      <button class="btn danger" type="button" data-action="remove">删除</button>
                    </div>
                  </div>
                  <div class="field-row field-row-2">
                    <div class="field">
                      <label>主题内容（中文）</label>
                      <textarea data-field="zh" rows="3" placeholder="输入本活动的写作主题描述...">${escapeHtml(zh)}</textarea>
                    </div>
                    <div class="field">
                      <label>主题内容（English）</label>
                      <textarea data-field="en" rows="3" placeholder="Writing theme description...">${escapeHtml(en)}</textarea>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("") || `<div class="rep-card" data-kind="writing-themes" data-index="0"><div class="rep-header"><div class="rep-title">主题 #1</div><div class="rep-actions"><button class="btn danger" type="button" data-action="remove">删除</button></div></div><div class="field-row field-row-2"><div class="field"><label>主题内容（中文）</label><textarea data-field="zh" rows="3" placeholder="输入本活动的写作主题描述..."></textarea></div><div class="field"><label>主题内容（English）</label><textarea data-field="en" rows="3" placeholder="Writing theme description..."></textarea></div></div></div>`;
      }

      // 渲染 Tags
      if (tagsEl) {
        const colorSchemeOptions = TAG_COLOR_SCHEMES.map(
          (cs) => `<option value="${escapeHtml(cs.value)}" ${cs.value === 'blue' ? 'selected' : ''}>${escapeHtml(cs.label)}</option>`
        ).join('');
        const iconOptions = LUCIDE_ICONS.map(
          (icon) => `<option value="${escapeHtml(icon.value)}">${escapeHtml(icon.label)}</option>`
        ).join('');
        
        tagsEl.innerHTML =
          tags
            .map((it, i) => {
              const colorScheme = it?.colorScheme || 'blue';
              const icon = it?.icon || 'Tag';
              const label = it?.label || '';
              const label_en = it?.label_en || '';
              const hoverTips = it?.hoverTips || '';
              const hoverTips_en = it?.hoverTips_en || '';
              const colorSchemeClass = TAG_COLOR_SCHEMES.find(cs => cs.value === colorScheme)?.className || 'tag-blue';
              
              return `
              <div class="rep-card tag-card ${escapeHtml(colorSchemeClass)}" data-kind="tags" data-index="${i}">
                <div class="rep-header">
                  <div class="rep-title">Tag #${i + 1}</div>
                  <div class="rep-actions">
                    <button class="btn" type="button" data-action="up">↑</button>
                    <button class="btn" type="button" data-action="down">↓</button>
                    <button class="btn danger" type="button" data-action="remove">删除</button>
                  </div>
                </div>
                <div class="tag-preview">
                  <span class="tag-preview-badge">
                    <span class="tag-preview-icon">${escapeHtml(icon)}</span>
                    <span class="tag-preview-label">${escapeHtml(label) || '未命名'}</span>
                  </span>
                </div>
                <div class="tag-fields">
                  <div class="tag-field">
                    <label>颜色系</label>
                    <select data-field="colorScheme" class="task-select">
                      ${TAG_COLOR_SCHEMES.map(cs => `
                        <option value="${escapeHtml(cs.value)}" ${cs.value === colorScheme ? 'selected' : ''}>${escapeHtml(cs.label)}</option>
                      `).join('')}
                    </select>
                  </div>
                  <div class="tag-field">
                    <label>图标</label>
                    <select data-field="icon" class="task-select">
                      ${LUCIDE_ICONS.map(ic => `
                        <option value="${escapeHtml(ic.value)}" ${ic.value === icon ? 'selected' : ''}>${escapeHtml(ic.label)}</option>
                      `).join('')}
                    </select>
                  </div>
                  <div class="tag-field tag-field-full">
                    <label>标签文本（中文）</label>
                    <input type="text" data-field="label" value="${escapeHtml(label)}" class="task-input" placeholder="输入中文标签显示文本..." />
                  </div>
                  <div class="tag-field tag-field-full">
                    <label>标签文本（English）</label>
                    <input type="text" data-field="label_en" value="${escapeHtml(label_en)}" class="task-input" placeholder="Enter English label..." />
                  </div>
                  <div class="tag-field tag-field-full">
                    <label>Hover 提示（中文，支持 HTML）</label>
                    <textarea data-field="hoverTips" rows="2" class="task-input" placeholder="输入中文悬停提示内容，支持 HTML...">${escapeHtml(hoverTips)}</textarea>
                  </div>
                  <div class="tag-field tag-field-full">
                    <label>Hover 提示（English，支持 HTML）</label>
                    <textarea data-field="hoverTips_en" rows="2" class="task-input" placeholder="Enter English hover tips, HTML supported...">${escapeHtml(hoverTips_en)}</textarea>
                  </div>
                </div>
              </div>
            `;
            })
            .join("") || `<div class="muted">暂无 tags，可点击上方"添加"</div>`;
      }

      // 初始化所有任务卡片的 custom 类型状态
      if (tasksEl) {
        tasksEl.querySelectorAll(".rep-card[data-kind='tasks']").forEach((card) => {
          const typeSelect = card.querySelector('.task-type-select');
          if (typeSelect) {
            const isCustom = typeSelect.value === 'custom';
            const urlInput = card.querySelector('.task-url-input');
            const autoCompleteCheckbox = card.querySelector('.task-autocomplete-checkbox');
            const autoCompleteField = card.querySelector('.task-field-autocomplete');
            
            if (urlInput && isCustom) {
              urlInput.value = "https://";
              urlInput.readOnly = true;
              urlInput.classList.add('is-readonly');
            }
            
            if (autoCompleteCheckbox && isCustom) {
              autoCompleteCheckbox.disabled = true;
              autoCompleteCheckbox.checked = false;
            }
            
            if (autoCompleteField && isCustom) {
              autoCompleteField.classList.add('is-disabled');
            }
          }
        });
      }
    }

    function clearEditor() {
      $("campaigns-editor-hint").textContent = "选择左侧一条活动开始编辑";
      $("campaigns-enabled").checked = false;
      $("campaigns-testingPhase").checked = false;
      $("campaigns-hasRiskConfirm").checked = false;
      $("campaigns-showSponsoredPolicy").checked = false;
      $("campaigns-enableEssayContest").checked = false;
      $("campaigns-enablePowLeaderboard").checked = false;
      // 隐藏征文大赛字段区域
      const essayFieldsEl = document.getElementById("essay-contest-fields");
      if (essayFieldsEl) {
        essayFieldsEl.style.display = "none";
      }
      // 隐藏POW榜单字段区域
      const powFieldsEl = document.getElementById("pow-leaderboard-fields");
      if (powFieldsEl) {
        powFieldsEl.style.display = "none";
      }
      // id、campaignKey、hotTweetsKey 字段是 disabled 的，不需要清空
      [
        "campaigns-twitter-handle",
        "campaigns-sortWeight",
        "campaigns-displayName-zh",
        "campaigns-displayName-en",
        "campaigns-startAt",
        "campaigns-endAt",
        "campaigns-rewardAmount",
        "campaigns-rewardParticipantCount",
        "campaigns-rewardDistributionType",
        "campaigns-rewardUnit",
        "campaigns-essayContestAmount",
        "campaigns-essayContestWinnerCount",
        "campaigns-essayContestUnit",
        "campaigns-powAmount",
        "campaigns-powWinnerCount",
        "campaigns-powDistributionType",
        "campaigns-powUnit",
        "campaigns-threshold",
        "campaigns-copy-emoji",
        "campaigns-copy-ctaText-zh",
        "campaigns-copy-ctaText-en",
        "campaigns-copy-shortTitle-zh",
        "campaigns-copy-shortTitle-en",
        "campaigns-copy-goToOfficialText-zh",
        "campaigns-copy-goToOfficialText-en",
        "campaigns-copy-viewGuideText-zh",
        "campaigns-copy-viewGuideText-en",
        "campaigns-links-guideUrl",
        "campaigns-links-activeUrl",
        "campaigns-projectIntroduction-zh",
        "campaigns-projectIntroduction-en",
        "campaigns-testList",
        "campaigns-targetUserIds",
      ].forEach((id) => {
        const el = $(id);
        if (el) el.value = "";
      });
      const showLeaderboardEl = $("campaigns-links-showLeaderboardLink");
      if (showLeaderboardEl) showLeaderboardEl.checked = false;
      $("campaigns-logos").innerHTML = "";
      const writingThemesEl = $("campaigns-writing-themes");
      if (writingThemesEl) writingThemesEl.innerHTML = "";
      $("campaigns-tasks").innerHTML = "";
      const essayWinnersEl = $("campaigns-essay-winners");
      if (essayWinnersEl) {
        essayWinnersEl.innerHTML = "";
      }
      const tagsEl = $("campaigns-tags");
      if (tagsEl) {
        tagsEl.innerHTML = "";
      }

      const body = $("campaigns-editor-body");
      const empty = $("campaigns-editor-empty");
      if (body && empty) {
        body.style.display = "none";
        empty.style.display = "block";
      }
      currentWebsiteOnlyRecord = null;
      setEditorMode("nacos");
      clearWebsiteConfigEditor("请先选择活动");

    }

    function selectCampaign(idx) {
      if ((currentSelectionType !== "nacos" || idx !== currentIndex) && !confirmDiscardWebsiteConfigChanges()) return;
      currentWebsiteOnlyRecord = null;
      setEditorMode("nacos");
      currentIndex = idx;
      const c = getCurrentCampaign();

      if (!c) {
        setControlsEnabled(false);
        clearEditor();
        renderList();
        return;
      }

      // ensure structures
      if (!c.enrollmentWindow || typeof c.enrollmentWindow !== "object")
        c.enrollmentWindow = { startAt: "", endAt: "" };
      if (!c.displayName || typeof c.displayName !== "object")
        c.displayName = { zh: "", en: "" };
      if (!c.copy || typeof c.copy !== "object")
        c.copy = {
          title: { zh: "", en: "" },
          shortTitle: { zh: "", en: "" },
          emoji: "",
          ctaText: { zh: "", en: "" },
          goToOfficialText: { zh: "", en: "" },
          viewGuideText: { zh: "", en: "" },
        };
      if (!c.copy.title) c.copy.title = { zh: "", en: "" };
      if (!c.copy.shortTitle) c.copy.shortTitle = { zh: "", en: "" };
      if (!c.copy.ctaText) c.copy.ctaText = { zh: "", en: "" };
      if (!c.copy.goToOfficialText) c.copy.goToOfficialText = { zh: "", en: "" };
      if (!c.copy.viewGuideText) c.copy.viewGuideText = { zh: "", en: "" };
      if (!c.links || typeof c.links !== "object") c.links = { guideUrl: "", activeUrl: "", showLeaderboardLink: false };
      if (!c.projectIntroduction || typeof c.projectIntroduction !== "object") {
        const legacy = typeof c.projectIntroduction === "string" ? c.projectIntroduction : "";
        c.projectIntroduction = { zh: legacy, en: "" };
      }
      if (!c.projectIntroduction.zh && c.projectIntroduction.zh !== "") c.projectIntroduction.zh = "";
      if (!c.projectIntroduction.en && c.projectIntroduction.en !== "") c.projectIntroduction.en = "";
      if (!Array.isArray(c.writingThemes)) {
        c.writingThemes = typeof c.writingThemes === "string" ? [{ zh: c.writingThemes, en: "" }] : [{ zh: "", en: "" }];
      }
      c.writingThemes = c.writingThemes.map((it) => {
        if (it && typeof it === "object" && ("zh" in it || "en" in it))
          return { zh: it.zh != null ? String(it.zh) : "", en: it.en != null ? String(it.en) : "" };
        return { zh: typeof it === "string" ? it : "", en: "" };
      });
      if (c.writingThemes.length === 0) c.writingThemes.push({ zh: "", en: "" });
      if (!Array.isArray(c.testList)) c.testList = [];
      if (!Array.isArray(c.targetUserIds)) c.targetUserIds = [];
      if (!Array.isArray(c.logos)) c.logos = [];
      if (!Array.isArray(c.tasks)) c.tasks = [];
      if (!Array.isArray(c.essayContestWinners)) c.essayContestWinners = [];
      // tags 是可选字段，保留原值（undefined 表示未配置）
      // 确保所有 logo 都有默认的 ringClassName
      const defaultRingClassName = "ring-blue-400/20 hover:ring-blue-400/50";
      c.logos.forEach((logo) => {
        if (!logo.ringClassName || logo.ringClassName.trim() === "") {
          logo.ringClassName = defaultRingClassName;
        }
      });

      setControlsEnabled(true);

      const body = $("campaigns-editor-body");
      const empty = $("campaigns-editor-empty");
      if (body && empty) {
        body.style.display = "block";
        empty.style.display = "none";
      }

      $("campaigns-editor-hint").textContent = `正在编辑：${c.id || "(未设置 id)"}`;
      $("campaigns-enabled").checked = !!c.enabled;
      $("campaigns-testingPhase").checked = !!c.testingPhase;

      // 判断活动是否已保存（有id且id不为空）
      const isSaved = !!(c.id && c.id.trim());
      
      // 设置推特号输入框
      const twitterHandleEl = $("campaigns-twitter-handle");
      if (twitterHandleEl) {
        if (isSaved) {
          // 已保存的活动：禁用输入框，显示当前的campaignKey
          twitterHandleEl.value = c.campaignKey || "";
          twitterHandleEl.disabled = true;
        } else {
          // 新活动：启用输入框，显示当前的campaignKey（如果有）
          twitterHandleEl.value = c.campaignKey || "";
          twitterHandleEl.disabled = false;
        }
      }

      $("campaigns-campaignKey").value = c.campaignKey || "";
      // id 自动从 campaignKey 生成（显示用，实际保存时也会自动生成）
      updateIdFromCampaignKey();
      $("campaigns-hotTweetsKey").value = c.hotTweetsKey || "";

      const sortWeightVal = c.sortWeight;
      const sortWeightNum = typeof sortWeightVal === "number" && Number.isFinite(sortWeightVal) ? Math.min(10000, Math.max(0, Math.round(sortWeightVal))) : 0;
      $("campaigns-sortWeight").value = sortWeightNum;

      $("campaigns-displayName-zh").value = c.displayName.zh || "";
      $("campaigns-displayName-en").value = c.displayName.en || "";

      $("campaigns-startAt").value = toDatetimeLocal(c.enrollmentWindow.startAt);
      $("campaigns-endAt").value = toDatetimeLocal(c.enrollmentWindow.endAt);

      // 奖励配置
      $("campaigns-rewardAmount").value = c.rewardAmount || "";
      $("campaigns-rewardParticipantCount").value = c.rewardParticipantCount || "";
      $("campaigns-rewardDistributionType").value = c.rewardDistributionType || "";
      $("campaigns-rewardUnit").value = c.rewardUnit || "";
      
      // 征文大赛配置
      const enableEssayContest = !!c.enableEssayContest;
      $("campaigns-enableEssayContest").checked = enableEssayContest;
      const essayFieldsEl = document.getElementById("essay-contest-fields");
      if (essayFieldsEl) {
        essayFieldsEl.style.display = enableEssayContest ? "block" : "none";
      }
      $("campaigns-essayContestAmount").value = c.essayContestAmount || "";
      $("campaigns-essayContestWinnerCount").value = c.essayContestWinnerCount || "";
      $("campaigns-essayContestUnit").value = c.essayContestUnit || "";
      
      // 确保 essayContestWinners 是数组
      if (!Array.isArray(c.essayContestWinners)) {
        c.essayContestWinners = [];
      }

      // POW榜单配置
      const enablePowLeaderboard = !!c.enablePowLeaderboard;
      $("campaigns-enablePowLeaderboard").checked = enablePowLeaderboard;
      const powFieldsEl = document.getElementById("pow-leaderboard-fields");
      if (powFieldsEl) {
        powFieldsEl.style.display = enablePowLeaderboard ? "block" : "none";
      }
      $("campaigns-powAmount").value = c.powAmount || "";
      $("campaigns-powWinnerCount").value = c.powWinnerCount || "";
      $("campaigns-powDistributionType").value = c.powDistributionType || "";
      $("campaigns-powUnit").value = c.powUnit || "";

      // 门槛（将数字转换为显示格式）
      if (c.includeCreator === true && c.threshold === 200000) {
        $("campaigns-threshold").value = "200k+creator";
      } else if (c.threshold !== undefined && c.threshold !== null) {
        // 将数字转换为显示格式
        if (c.threshold === 50000) {
          $("campaigns-threshold").value = "50k";
        } else if (c.threshold === 100000) {
          $("campaigns-threshold").value = "100k";
        } else if (c.threshold === 200000) {
          $("campaigns-threshold").value = "200k";
        } else if (typeof c.threshold === "number") {
          // 如果是其他数字，直接显示（兼容老数据或其他值）
          $("campaigns-threshold").value = String(c.threshold);
        } else {
          // 如果是字符串（兼容老数据），直接显示
          $("campaigns-threshold").value = c.threshold;
        }
      } else {
        $("campaigns-threshold").value = "";
      }

      // 早期项目提示（如果有riskConfirmHtml字段且不为null，则勾选）
      $("campaigns-hasRiskConfirm").checked = !!(c.riskConfirmHtml && c.riskConfirmHtml !== null);
      $("campaigns-showSponsoredPolicy").checked = c.showSponsoredPolicy === true;

      $("campaigns-copy-emoji").value = c.copy.emoji || "";
      $("campaigns-copy-ctaText-zh").value = c.copy.ctaText.zh || "";
      $("campaigns-copy-ctaText-en").value = c.copy.ctaText.en || "";
      // title 字段不显示，自动从 shortTitle 同步
      $("campaigns-copy-shortTitle-zh").value = c.copy.shortTitle.zh || "";
      $("campaigns-copy-shortTitle-en").value = c.copy.shortTitle.en || "";
      // 确保 title 从 shortTitle 同步
      if (!c.copy.title) c.copy.title = {};
      c.copy.title.zh = c.copy.shortTitle.zh || c.copy.title.zh || "";
      c.copy.title.en = c.copy.shortTitle.en || c.copy.title.en || "";
      $("campaigns-copy-goToOfficialText-zh").value =
        c.copy.goToOfficialText.zh || "";
      $("campaigns-copy-goToOfficialText-en").value =
        c.copy.goToOfficialText.en || "";
      $("campaigns-copy-viewGuideText-zh").value =
        c.copy.viewGuideText.zh || "";
      $("campaigns-copy-viewGuideText-en").value =
        c.copy.viewGuideText.en || "";

      $("campaigns-links-guideUrl").value = c.links.guideUrl || "";
      $("campaigns-links-activeUrl").value = c.links.activeUrl || "";
      const showLeaderboardEl = $("campaigns-links-showLeaderboardLink");
      if (showLeaderboardEl) showLeaderboardEl.checked = !!(c.links.showLeaderboardLink);

      const projectIntroZh = $("campaigns-projectIntroduction-zh");
      const projectIntroEn = $("campaigns-projectIntroduction-en");
      if (projectIntroZh) projectIntroZh.value = (c.projectIntroduction && c.projectIntroduction.zh) || "";
      if (projectIntroEn) projectIntroEn.value = (c.projectIntroduction && c.projectIntroduction.en) || "";

      $("campaigns-testList").value = listToLines(c.testList);
      $("campaigns-targetUserIds").value = listToLines(c.targetUserIds);

      renderRepeaters();
      renderList();
      loadWebsiteConfigForCurrentCampaign();
    }

    function selectWebsiteOnlyRecord(nacosCampaignId) {
      if (!confirmDiscardWebsiteConfigChanges()) return;
      const record = (websiteCampaignRecords || []).find((item) => String(item.nacosCampaignId) === String(nacosCampaignId));
      currentWebsiteOnlyRecord = record || null;
      currentIndex = -1;
      setEditorMode("website_only");
      setControlsEnabled(false);
      const body = $("campaigns-editor-body");
      const empty = $("campaigns-editor-empty");
      if (body && empty) {
        body.style.display = "block";
        empty.style.display = "none";
      }
      $("campaigns-editor-hint").textContent = `正在编辑网页独有数据：${(record && (record.campaignKey || record.slug || record.nacosCampaignId)) || ""}`;
      fillWebsiteConfigForm(record, record || {});
      renderList();
    }

    function syncCampaignFromInputs() {
      const c = getCurrentCampaign();
      if (!c) return;

      c.enabled = !!$("campaigns-enabled").checked;
      c.testingPhase = !!$("campaigns-testingPhase").checked;

      // 从推特号输入框读取值（如果未禁用）
      const twitterHandleEl = $("campaigns-twitter-handle");
      if (twitterHandleEl && !twitterHandleEl.disabled) {
        const twitterHandle = twitterHandleEl.value.trim();
        if (twitterHandle) {
          c.campaignKey = twitterHandle;
          c.hotTweetsKey = twitterHandle;
          c.id = `${twitterHandle}-hunter`;
          // 同步更新显示字段
          $("campaigns-campaignKey").value = twitterHandle;
          $("campaigns-hotTweetsKey").value = twitterHandle;
          updateIdFromCampaignKey();
        } else {
          c.campaignKey = "";
          c.hotTweetsKey = "";
          c.id = "";
        }
      } else {
        // 如果已禁用（已保存的活动），则从原有字段读取（虽然不应该改变）
        c.campaignKey = $("campaigns-campaignKey").value.trim();
        c.hotTweetsKey = $("campaigns-hotTweetsKey").value.trim();
        c.id = c.campaignKey ? `${c.campaignKey}-hunter` : "";
      }

      const sortWeightRaw = $("campaigns-sortWeight").value.trim();
      const sortWeightParsed = sortWeightRaw === "" ? 0 : parseInt(sortWeightRaw, 10);
      c.sortWeight = Number.isFinite(sortWeightParsed) ? Math.min(10000, Math.max(0, sortWeightParsed)) : 0;

      c.displayName = c.displayName || {};
      c.displayName.zh = $("campaigns-displayName-zh").value;
      c.displayName.en = $("campaigns-displayName-en").value;

      c.enrollmentWindow = c.enrollmentWindow || {};
      c.enrollmentWindow.startAt = fromDatetimeLocalToIsoZ($("campaigns-startAt").value);
      c.enrollmentWindow.endAt = fromDatetimeLocalToIsoZ($("campaigns-endAt").value);

      // 奖励配置（如果为空则删除字段，保持老数据兼容）
      const rewardAmountVal = $("campaigns-rewardAmount").value.trim();
      if (rewardAmountVal) {
        c.rewardAmount = parseInt(rewardAmountVal, 10);
      } else {
        delete c.rewardAmount;
      }

      const rewardParticipantCountVal = $("campaigns-rewardParticipantCount").value.trim();
      if (rewardParticipantCountVal) {
        c.rewardParticipantCount = parseInt(rewardParticipantCountVal, 10);
      } else {
        delete c.rewardParticipantCount;
      }

      const rewardDistributionTypeVal = $("campaigns-rewardDistributionType").value.trim();
      if (rewardDistributionTypeVal) {
        c.rewardDistributionType = rewardDistributionTypeVal;
      } else {
        delete c.rewardDistributionType;
      }

      // 奖励金额展示单位
      const rewardUnitVal = $("campaigns-rewardUnit").value.trim();
      if (rewardUnitVal) {
        c.rewardUnit = rewardUnitVal;
      } else {
        delete c.rewardUnit;
      }

      // 征文大赛配置
      const enableEssayContest = $("campaigns-enableEssayContest").checked;
      if (enableEssayContest) {
        c.enableEssayContest = true;
        
        const essayContestAmountVal = $("campaigns-essayContestAmount").value.trim();
        if (essayContestAmountVal) {
          c.essayContestAmount = parseInt(essayContestAmountVal, 10);
        } else {
          c.essayContestAmount = 0;
        }
        
        const essayContestWinnerCountVal = $("campaigns-essayContestWinnerCount").value.trim();
        if (essayContestWinnerCountVal) {
          c.essayContestWinnerCount = parseInt(essayContestWinnerCountVal, 10);
        } else {
          delete c.essayContestWinnerCount;
        }
        
        // 征文大赛奖励单位（选填）
        const essayContestUnitVal = $("campaigns-essayContestUnit").value.trim();
        if (essayContestUnitVal) {
          c.essayContestUnit = essayContestUnitVal;
        } else {
          delete c.essayContestUnit;
        }
        
        // 征文大赛最终名单（已经是数组格式，直接使用）
        if (!Array.isArray(c.essayContestWinners)) {
          c.essayContestWinners = [];
        }
      } else {
        delete c.enableEssayContest;
        delete c.essayContestAmount;
        delete c.essayContestWinnerCount;
        delete c.essayContestUnit;
        delete c.essayContestWinners;
      }

      // POW榜单配置
      const enablePowLeaderboard = $("campaigns-enablePowLeaderboard").checked;
      if (enablePowLeaderboard) {
        c.enablePowLeaderboard = true;
        
        const powAmountVal = $("campaigns-powAmount").value.trim();
        if (powAmountVal) {
          c.powAmount = parseInt(powAmountVal, 10);
        } else {
          c.powAmount = 0;
        }
        
        const powWinnerCountVal = $("campaigns-powWinnerCount").value.trim();
        if (powWinnerCountVal) {
          c.powWinnerCount = parseInt(powWinnerCountVal, 10);
        } else {
          delete c.powWinnerCount;
        }
        
        const powDistributionTypeVal = $("campaigns-powDistributionType").value.trim();
        if (powDistributionTypeVal) {
          c.powDistributionType = powDistributionTypeVal;
        } else {
          delete c.powDistributionType;
        }
        
        const powUnitVal = $("campaigns-powUnit").value.trim();
        if (powUnitVal) {
          c.powUnit = powUnitVal;
        } else {
          delete c.powUnit;
        }
      } else {
        delete c.enablePowLeaderboard;
        delete c.powAmount;
        delete c.powWinnerCount;
        delete c.powDistributionType;
        delete c.powUnit;
      }

      // 门槛（如果选择了 "200k+creator"，则 threshold 设为 200000，includeCreator 设为 true；否则设为 false）
      const thresholdVal = $("campaigns-threshold").value.trim();
      if (thresholdVal) {
        if (thresholdVal === "200k+creator") {
          c.threshold = 200000;
          c.includeCreator = true;
        } else {
          // 将 "50k", "100k", "200k" 转换为纯数字
          if (thresholdVal === "50k") {
            c.threshold = 50000;
          } else if (thresholdVal === "100k") {
            c.threshold = 100000;
          } else if (thresholdVal === "200k") {
            c.threshold = 200000;
          } else {
            // 如果已经是数字，直接使用
            const numVal = parseInt(thresholdVal, 10);
            c.threshold = !isNaN(numVal) ? numVal : thresholdVal;
          }
          c.includeCreator = false;
        }
      } else {
        // 如果 threshold 为空（老数据），删除这两个字段
        delete c.threshold;
        delete c.includeCreator;
      }

      // 早期项目提示
      if ($("campaigns-hasRiskConfirm").checked) {
        c.riskConfirmHtml = {
          zh: "<p><strong>重要提示：</strong>该项目为 Early-stage 项目，信息由项目方提供，请在参与前自行判断。点击继续即表示理解并接受。</p>",
          en: "<p><strong>Important Notice:</strong> The project is in its early stage. The information is provided by the project team. Please make an informed decision before participating. Proceeding indicates that you understand and accept this.</p>"
        };
      } else {
        c.riskConfirmHtml = null;
      }

      // 付费推广政策提示
      c.showSponsoredPolicy = $("campaigns-showSponsoredPolicy").checked;

      c.copy = c.copy || {};
      c.copy.emoji = $("campaigns-copy-emoji").value;
      setByPath(c.copy, "ctaText.zh", $("campaigns-copy-ctaText-zh").value);
      setByPath(c.copy, "ctaText.en", $("campaigns-copy-ctaText-en").value);
      // title 自动从 shortTitle 同步
      setByPath(c.copy, "shortTitle.zh", $("campaigns-copy-shortTitle-zh").value);
      setByPath(c.copy, "shortTitle.en", $("campaigns-copy-shortTitle-en").value);
      setByPath(c.copy, "title.zh", $("campaigns-copy-shortTitle-zh").value);
      setByPath(c.copy, "title.en", $("campaigns-copy-shortTitle-en").value);
      setByPath(
        c.copy,
        "goToOfficialText.zh",
        $("campaigns-copy-goToOfficialText-zh").value
      );
      setByPath(
        c.copy,
        "goToOfficialText.en",
        $("campaigns-copy-goToOfficialText-en").value
      );
      setByPath(
        c.copy,
        "viewGuideText.zh",
        $("campaigns-copy-viewGuideText-zh").value
      );
      setByPath(
        c.copy,
        "viewGuideText.en",
        $("campaigns-copy-viewGuideText-en").value
      );

      c.links = c.links || {};
      c.links.guideUrl = $("campaigns-links-guideUrl").value.trim();
      c.links.activeUrl = $("campaigns-links-activeUrl").value.trim();
      c.links.showLeaderboardLink = !!($("campaigns-links-showLeaderboardLink") && $("campaigns-links-showLeaderboardLink").checked);

      const projectIntroZh = $("campaigns-projectIntroduction-zh");
      const projectIntroEn = $("campaigns-projectIntroduction-en");
      c.projectIntroduction = {
        zh: projectIntroZh ? projectIntroZh.value.trim() : "",
        en: projectIntroEn ? projectIntroEn.value.trim() : "",
      };

      c.testList = splitLinesToList($("campaigns-testList").value);
      c.targetUserIds = splitLinesToList($("campaigns-targetUserIds").value);

      // 更新所有 task 的 id（如果 campaignKey、type、url 都存在）
      if (Array.isArray(c.tasks)) {
        const campaignKey = c.campaignKey || "";
        c.tasks.forEach((task) => {
          const type = task?.type || "";
          const url = task?.url || "";
          if (campaignKey && type && url) {
            task.id = generateTaskId(campaignKey, type, url);
          }
        });
        // 重新渲染以更新显示的 id
        renderRepeaters();
      }

      // tags 是可选字段：如果为空数组或未配置，删除该字段以减少 JSON 大小
      if (!c.tags || (Array.isArray(c.tags) && c.tags.length === 0)) {
        delete c.tags;
      }

      dirty = true;
      $("campaigns-publish").disabled = false;
      // 避免频繁重建整个列表导致头像重复加载，只增量更新当前条目
      updateListItemForCampaign(c, currentIndex);
    }

    function updateIdFromCampaignKey() {
      const campaignKey = $("campaigns-campaignKey").value.trim();
      const idEl = $("campaigns-id");
      if (idEl) {
        idEl.value = campaignKey ? `${campaignKey}-hunter` : "";
      }
    }

    function generateTaskId(campaignKey, type, url) {
      if (!campaignKey || !type || !url) return "";
      try {
        // 只对 url 进行 base64 编码，取前8位
        const urlBase64 = btoa(unescape(encodeURIComponent(url)));
        // 前6位和后6位拼接，避免重复
        const finalUrlBase64 = urlBase64.substring(0, 6) + "-" + urlBase64.substring(urlBase64.length - 6);
        return `${campaignKey}-${type}-${finalUrlBase64}`;
      } catch (e) {
        console.error("生成 task id 失败:", e);
        return "";
      }
    }

    function updateFieldsFromTwitterHandle() {
      const twitterHandle = $("campaigns-twitter-handle").value.trim();
      if (twitterHandle) {
        $("campaigns-campaignKey").value = twitterHandle;
        $("campaigns-hotTweetsKey").value = twitterHandle;
        updateIdFromCampaignKey();
      } else {
        $("campaigns-campaignKey").value = "";
        $("campaigns-hotTweetsKey").value = "";
        $("campaigns-id").value = "";
      }
    }

    function bindInputSync() {
      // 推特号输入框的特殊处理
      const twitterHandleEl = $("campaigns-twitter-handle");
      if (twitterHandleEl) {
        twitterHandleEl.addEventListener("input", () => {
          if (!isEditorEnabled()) return;
          updateFieldsFromTwitterHandle();
          syncCampaignFromInputs();
        });
      }

      // 排序权重：失焦时限制在 0～10000
      const sortWeightEl = $("campaigns-sortWeight");
      if (sortWeightEl) {
        sortWeightEl.addEventListener("blur", () => {
          const v = parseInt(sortWeightEl.value, 10);
          if (!Number.isFinite(v)) {
            sortWeightEl.value = "0";
          } else if (v < 0) {
            sortWeightEl.value = "0";
          } else if (v > 10000) {
            sortWeightEl.value = "10000";
          }
          if (isEditorEnabled()) syncCampaignFromInputs();
        });
      }

      // 早期项目提示checkbox的特殊处理
      const hasRiskConfirmEl = $("campaigns-hasRiskConfirm");
      if (hasRiskConfirmEl) {
        hasRiskConfirmEl.addEventListener("change", () => {
          if (!isEditorEnabled()) return;
          syncCampaignFromInputs();
        });
      }

      // 征文大赛开关的特殊处理
      const enableEssayContestEl = $("campaigns-enableEssayContest");
      if (enableEssayContestEl) {
        enableEssayContestEl.addEventListener("change", () => {
          if (!isEditorEnabled()) return;
          const essayFieldsEl = document.getElementById("essay-contest-fields");
          if (essayFieldsEl) {
            essayFieldsEl.style.display = enableEssayContestEl.checked ? "block" : "none";
          }
          syncCampaignFromInputs();
        });
      }

      // POW榜单开关的特殊处理
      const enablePowLeaderboardEl = $("campaigns-enablePowLeaderboard");
      if (enablePowLeaderboardEl) {
        enablePowLeaderboardEl.addEventListener("change", () => {
          if (!isEditorEnabled()) return;
          const powFieldsEl = document.getElementById("pow-leaderboard-fields");
          if (powFieldsEl) {
            powFieldsEl.style.display = enablePowLeaderboardEl.checked ? "block" : "none";
          }
          syncCampaignFromInputs();
        });
      }

      const ids = [
        "campaigns-sortWeight",
        "campaigns-displayName-zh",
        "campaigns-displayName-en",
        "campaigns-startAt",
        "campaigns-endAt",
        "campaigns-rewardAmount",
        "campaigns-rewardParticipantCount",
        "campaigns-rewardDistributionType",
        "campaigns-rewardUnit",
        "campaigns-essayContestAmount",
        "campaigns-essayContestWinnerCount",
        "campaigns-essayContestUnit",
        "campaigns-powAmount",
        "campaigns-powWinnerCount",
        "campaigns-powDistributionType",
        "campaigns-powUnit",
        "campaigns-threshold",
        "campaigns-copy-emoji",
        "campaigns-copy-ctaText-zh",
        "campaigns-copy-ctaText-en",
        "campaigns-copy-shortTitle-zh",
        "campaigns-copy-shortTitle-en",
        "campaigns-copy-goToOfficialText-zh",
        "campaigns-copy-goToOfficialText-en",
        "campaigns-copy-viewGuideText-zh",
        "campaigns-copy-viewGuideText-en",
        "campaigns-links-guideUrl",
        "campaigns-links-activeUrl",
        "campaigns-links-showLeaderboardLink",
        "campaigns-projectIntroduction-zh",
        "campaigns-projectIntroduction-en",
        "campaigns-testList",
        "campaigns-targetUserIds",
      ];

      ids.forEach((id) => {
        const el = $(id);
        if (!el) return;
        const evt = el.type === "checkbox" ? "change" : "input";
        el.addEventListener(evt, () => {
          if (!isEditorEnabled()) return;
          syncCampaignFromInputs();
        });
      });

      getWebsiteConfigIds().forEach((id) => {
        const el = $(id);
        if (!el) return;
        const evt = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, () => {
          if (el.id === "campaigns-webStatus") toggleClaimConfigByStatus();
          if (el.id === "campaigns-templateConfig") {
            try {
              parseTemplateConfigFromEditor();
            } catch (_) {}
          }
          websiteConfigDirty = true;
          const saveBtn = $("campaigns-save-website");
          if (saveBtn) saveBtn.disabled = false;
        });
      });

      ["campaigns-enabled", "campaigns-testingPhase"].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("change", () => {
          if (!isEditorEnabled()) return;
          syncCampaignFromInputs();
        });
      });
    }

    function addLogo() {
      const c = getCurrentCampaign();
      if (!c) return;
      c.logos = Array.isArray(c.logos) ? c.logos : [];
      c.logos.push({
        image: "",
        url: "",
        label: "",
        ringClassName: "ring-blue-400/20 hover:ring-blue-400/50",
      });
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderRepeaters();
    }

    function addTask() {
      const c = getCurrentCampaign();
      if (!c) return;
      c.tasks = Array.isArray(c.tasks) ? c.tasks : [];
      c.tasks.push({
        id: "",
        title: { zh: "", en: "" },
        url: "",
        type: "twitter",
        autoComplete: false,
      });
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderRepeaters();
    }

    function addEssayContestWinner() {
      const c = getCurrentCampaign();
      if (!c) return;
      c.essayContestWinners = Array.isArray(c.essayContestWinners) ? c.essayContestWinners : [];
      c.essayContestWinners.push({
        name: "",
        handler: "",
        avatar: "",
        reward: "",
      });
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderRepeaters();
    }

    function addTag() {
      const c = getCurrentCampaign();
      if (!c) return;
      c.tags = Array.isArray(c.tags) ? c.tags : [];
      c.tags.push({
        colorScheme: "blue",
        icon: "Tag",
        label: "",
        label_en: "",
        hoverTips: "",
        hoverTips_en: "",
      });
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderRepeaters();
    }

    function addWritingTheme() {
      const c = getCurrentCampaign();
      if (!c) return;
      c.writingThemes = Array.isArray(c.writingThemes) ? c.writingThemes : [{ zh: "", en: "" }];
      if (c.writingThemes.length === 0) c.writingThemes.push({ zh: "", en: "" });
      c.writingThemes.push({ zh: "", en: "" });
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderRepeaters();
    }

    function moveArrayItem(arr, from, to) {
      if (!Array.isArray(arr)) return;
      if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return;
      const it = arr.splice(from, 1)[0];
      arr.splice(to, 0, it);
    }

    function bindRepeatersEvents() {
      function onRepInput(containerId, fieldSetter) {
        const root = $(containerId);
        if (!root) return;
        root.addEventListener("input", (e) => {
          const card = e.target.closest(".rep-card");
          if (!card) return;
          const kind = card.getAttribute("data-kind");
          const index = Number(card.getAttribute("data-index"));
          const field = e.target.getAttribute("data-field");
          if (!kind || !field || !Number.isFinite(index)) return;

          const c = getCurrentCampaign();
          if (!c) return;
          let arr;
          if (kind === "logos") {
            arr = c.logos;
          } else if (kind === "tasks") {
            arr = c.tasks;
          } else if (kind === "essay-winners") {
            arr = c.essayContestWinners;
          } else if (kind === "writing-themes") {
            arr = c.writingThemes;
          } else if (kind === "tags") {
            arr = c.tags;
          } else {
            return;
          }
          if (!Array.isArray(arr) || !(index in arr)) return;

          let value = e.target.type === "checkbox" ? !!e.target.checked : e.target.value;
          
          // 处理 custom 类型切换
          if (kind === "tasks" && field === "type" && value === "custom") {
            arr[index].url = "https://";
            arr[index].autoComplete = false;
          }
          
          if (kind === "writing-themes" && (field === "zh" || field === "en")) {
            if (!arr[index] || typeof arr[index] !== "object") arr[index] = { zh: "", en: "" };
            arr[index][field] = value;
          } else {
            fieldSetter(arr[index], field, value);
          }

          // 如果是 task 的 type 或 url 改变，自动更新 id
          if (kind === "tasks" && (field === "type" || field === "url")) {
            const task = arr[index];
            const campaignKey = c?.campaignKey || "";
            const type = task?.type || "";
            const url = type === "custom" ? "https://" : (task?.url || "");
            if (campaignKey && type && url) {
              task.id = generateTaskId(campaignKey, type, url);
            }
            // 重新渲染以更新显示的 id
            renderRepeaters();
          }

          dirty = true;
          $("campaigns-publish").disabled = false;
          renderList();
        });

        root.addEventListener("change", (e) => {
          if (e.target.tagName !== "SELECT" && e.target.type !== "checkbox") return;
          const card = e.target.closest(".rep-card");
          if (!card) return;
          const kind = card.getAttribute("data-kind");
          const index = Number(card.getAttribute("data-index"));
          const field = e.target.getAttribute("data-field");
          if (!kind || !field || !Number.isFinite(index)) return;

          const c = getCurrentCampaign();
          if (!c) return;
          let arr;
          if (kind === "logos") {
            arr = c.logos;
          } else if (kind === "tasks") {
            arr = c.tasks;
          } else if (kind === "essay-winners") {
            arr = c.essayContestWinners;
          } else if (kind === "writing-themes") {
            arr = c.writingThemes;
          } else {
            return;
          }
          if (!Array.isArray(arr) || !(index in arr)) return;
          let value = e.target.type === "checkbox" ? !!e.target.checked : e.target.value;
          
          // 处理 custom 类型切换
          if (kind === "tasks" && field === "type" && value === "custom") {
            arr[index].url = "https://";
            arr[index].autoComplete = false;
          }
          
          if (kind === "writing-themes" && (field === "zh" || field === "en")) {
            if (!arr[index] || typeof arr[index] !== "object") arr[index] = { zh: "", en: "" };
            arr[index][field] = value;
          } else {
            fieldSetter(arr[index], field, value);
          }

          // 如果是 task 的 type 或 url 改变，自动更新 id
          if (kind === "tasks" && (field === "type" || field === "url")) {
            const task = arr[index];
            const campaignKey = c?.campaignKey || "";
            const type = task?.type || "";
            const url = type === "custom" ? "https://" : (task?.url || "");
            if (campaignKey && type && url) {
              task.id = generateTaskId(campaignKey, type, url);
            }
            // 重新渲染以更新显示的 id 和 UI 状态
            renderRepeaters();
          }

          dirty = true;
          $("campaigns-publish").disabled = false;
          renderList();
        });

        root.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action]");
          if (!btn) return;
          const action = btn.getAttribute("data-action");
          const card = btn.closest(".rep-card");
          if (!card) return;
          const kind = card.getAttribute("data-kind");
          const index = Number(card.getAttribute("data-index"));
          const c = getCurrentCampaign();
          if (!c) return;
          let arr;
          if (kind === "logos") {
            arr = c.logos;
          } else if (kind === "tasks") {
            arr = c.tasks;
          } else if (kind === "essay-winners") {
            arr = c.essayContestWinners;
          } else if (kind === "writing-themes") {
            arr = c.writingThemes;
          } else if (kind === "tags") {
            arr = c.tags;
          } else {
            return;
          }
          if (!Array.isArray(arr)) return;

          if (action === "remove") {
            if (kind === "writing-themes" && arr.length <= 1) return;
            arr.splice(index, 1);
            // 如果是 tags 且删除后为空，删除整个 tags 字段
            if (kind === "tags" && c.tags && c.tags.length === 0) {
              delete c.tags;
            }
          } else if (action === "up") {
            moveArrayItem(arr, index, index - 1);
          } else if (action === "down") {
            moveArrayItem(arr, index, index + 1);
          } else {
            return;
          }

          dirty = true;
          $("campaigns-publish").disabled = false;
          renderRepeaters();
          renderList();
        });
      }

      onRepInput("campaigns-logos", (obj, field, value) => {
        // ringClassName 始终使用默认值，不允许用户修改
        if (field === "ringClassName") {
          obj[field] = "ring-blue-400/20 hover:ring-blue-400/50";
        } else {
          obj[field] = value;
        }
      });
      onRepInput("campaigns-tasks", (obj, field, value) => {
        if (field.includes(".")) {
          setByPath(obj, field, value);
        } else {
          obj[field] = value;
        }
      });
      onRepInput("campaigns-essay-winners", (obj, field, value) => {
        obj[field] = value;
      });
      onRepInput("campaigns-writing-themes", (obj, field, value) => {
        if (typeof obj !== "string") return;
        // writing-themes 在分支里已处理 arr[index]=value
      });
      onRepInput("campaigns-tags", (obj, field, value) => {
        obj[field] = value;
        // 更新时实时刷新预览
        if (field === "colorScheme" || field === "icon" || field === "label" || field === "label_en") {
          renderRepeaters();
        }
      });
    }

    function newCampaign() {
      // 如果有未发布的活动，不允许新增
      if (!confirmDiscardWebsiteConfigChanges()) return;
      if (dirty) {
        const ok = window.confirm(
          "你当前有未发布的修改，新增活动会丢失这些修改。\n确认继续新增？"
        );
        if (!ok) return;
        // 如果用户确认，清除 dirty 状态（相当于放弃之前的修改）
        dirty = false;
        $("campaigns-publish").disabled = true;
      }

      const c = {
        id: "", // id 初始为空，等用户填写 campaignKey 后自动生成
        campaignKey: "",
        sortWeight: 0,
        enabled: false,
        // 默认先只开放给内部测试号
        testList: ["luoyukun4"],
        testingPhase: true,
        enrollmentWindow: { startAt: "", endAt: "" },
        displayName: { zh: "", en: "" },
        logos: [
          {
            image: "REPLACE_WITH_XHUNT_AVATAR_URL",
            url: "https://x.com/xhunt_ai",
            label: "XHunt AI",
            ringClassName: "ring-blue-400/20 hover:ring-blue-400/50",
          },
        ],
        copy: {
          title: { zh: "", en: "" },
          shortTitle: { zh: "", en: "" },
          // 从现有活动中抽取的默认文案
          emoji: "🎉",
          ctaText: { zh: "立即参与", en: "Join Now" },
          goToOfficialText: { zh: "前往官方", en: "Go to Official" },
          viewGuideText: { zh: "查看官方指南", en: "View Official Guide" },
        },
        tasks: [
          {
            id: "follow-xhunt",
            title: { zh: "关注 @xhunt_ai", en: "Follow @xhunt_ai" },
            url: "https://x.com/xhunt_ai",
            type: "twitter",
            autoComplete: true,
          },
        ],
        links: { guideUrl: "https://", activeUrl: "https://xhunt.ai/leaderboard", showLeaderboardLink: false },
        projectIntroduction: { zh: "", en: "" },
        writingThemes: [{ zh: "", en: "" }],
        showExtraComponents: true,
        targetUserIds: [],
        hotTweetsKey: "",
        // 新增活动必填字段（新活动必须填写，老数据兼容）
        rewardAmount: undefined,
        rewardParticipantCount: undefined,
        rewardDistributionType: undefined,
        rewardUnit: undefined,
        enableEssayContest: false,
        essayContestAmount: undefined,
        essayContestWinnerCount: undefined,
        essayContestUnit: undefined,
        essayContestWinners: undefined,
        enablePowLeaderboard: false,
        powAmount: undefined,
        powWinnerCount: undefined,
        powDistributionType: undefined,
        powUnit: undefined,
        threshold: undefined,
        includeCreator: false,
        showSponsoredPolicy: true,
      };
      config.campaigns.unshift(c);
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderList();
      selectCampaign(0);
      // 确保 id 显示正确（初始为空，等用户填写 campaignKey 后自动更新）
      updateIdFromCampaignKey();
      toast("已新增一条活动（未发布）", "info");
    }

    function duplicateCampaign() {
      if (!confirmDiscardWebsiteConfigChanges()) return;
      const c = getCurrentCampaign();
      if (!c) return;
      const copy = JSON.parse(JSON.stringify(c));
      // 清空 id，使复制出的活动被视为「未保存」，投放者推特号可编辑（可改为 mantle2 等）
      copy.id = "";
      // 复制出来的活动默认关闭、非测试状态，避免误上线
      copy.enabled = false;
      copy.testingPhase = false;
      config.campaigns.splice(currentIndex + 1, 0, copy);
      dirty = true;
      $("campaigns-publish").disabled = false;
      renderList();
      selectCampaign(currentIndex + 1);
      toast("已复制活动（未发布）", "info");
    }

    async function deleteCampaign() {
      if (!confirmDiscardWebsiteConfigChanges()) return;
      const c = getCurrentCampaign();
      if (!c) return;
      const okFirst = window.confirm(
        `确认删除该活动？\n\nid=${c.id || ""}\n\n提示：删除后将立即发布到 Nacos 生效。`
      );
      if (!okFirst) return;
      const okSecond = window.confirm(
        "确定删除该活动？\n\n此操作将立即发布到 Nacos，无法恢复。"
      );
      if (!okSecond) return;
      config.campaigns.splice(currentIndex, 1);
      currentIndex = -1;
      setControlsEnabled(false);
      clearEditor();
      renderList();

      try {
        toast("正在删除并发布到 Nacos...", "info");
        const content = JSON.stringify(config, null, 2);
        await apiPublishConfig({ dataId: DATA_ID, content, group: GROUP });
        dirty = false;
        originalConfig = JSON.parse(JSON.stringify(config));
        $("campaigns-publish").disabled = true;
        toast("删除已生效（已发布）", "success");
      } catch (e) {
        console.error("deleteCampaign publish error:", e);
        dirty = true;
        $("campaigns-publish").disabled = false;
        toast("删除未能发布：" + (e.message || "未知错误") + "（可点击「发布」重试）", "error");
      }
    }

    async function loadFromNacos() {
      $("campaigns-dataid").textContent = DATA_ID;
      toast("正在从 Nacos 加载...", "info");
      const [data, records] = await Promise.all([apiGetConfig(DATA_ID), apiListAllWebsiteCampaigns()]);
      let parsed;
      try {
        parsed = JSON.parse(data.content || "{}");
      } catch (e) {
        throw new Error("Nacos content 不是合法 JSON，请检查当前配置内容");
      }
      config = normalizeConfig(parsed);
      websiteCampaignRecords = Array.isArray(records) ? records : [];
      // 保存原始配置用于对比
      originalConfig = JSON.parse(JSON.stringify(config));
      dirty = false;
      $("campaigns-publish").disabled = true;
      currentIndex = -1;
      setControlsEnabled(false);
      renderList();
      clearEditor();
      toast("加载完成", "success");
    }

    function validateCampaigns() {
      const errors = [];
      const campaigns = Array.isArray(config.campaigns) ? config.campaigns : [];

      if (campaigns.length === 0) {
        return { valid: false, errors: ["至少需要配置一个活动"] };
      }

      campaigns.forEach((c, idx) => {
        const prefix = `活动 #${idx + 1} (id: ${c.id || "未设置"})`;

        // 必填：campaignKey（id 会自动从 campaignKey 生成）
        if (!c.campaignKey || !c.campaignKey.trim()) {
          errors.push(`${prefix}: campaignKey 不能为空`);
        } else {
          // 如果 campaignKey 存在，确保 id 已自动生成
          const expectedId = `${c.campaignKey.trim()}-hunter`;
          if (!c.id || c.id.trim() !== expectedId) {
            // 自动修正 id
            c.id = expectedId;
          }
        }

        // 必填：displayName（至少一个语言）
        if (
          (!c.displayName || typeof c.displayName !== "object") ||
          ((!c.displayName.zh || !c.displayName.zh.trim()) &&
            (!c.displayName.en || !c.displayName.en.trim()))
        ) {
          errors.push(`${prefix}: displayName 至少需要填写中文或英文`);
        }

        // 必填：enrollmentWindow（startAt 和 endAt）
        if (
          !c.enrollmentWindow ||
          typeof c.enrollmentWindow !== "object" ||
          !c.enrollmentWindow.startAt ||
          !c.enrollmentWindow.endAt
        ) {
          errors.push(`${prefix}: enrollmentWindow 的 startAt 和 endAt 都必须填写`);
        }

        // 必填：copy.shortTitle（至少一个语言），title 会自动从 shortTitle 同步
        if (
          !c.copy ||
          typeof c.copy !== "object" ||
          !c.copy.shortTitle ||
          typeof c.copy.shortTitle !== "object" ||
          ((!c.copy.shortTitle.zh || !c.copy.shortTitle.zh.trim()) &&
            (!c.copy.shortTitle.en || !c.copy.shortTitle.en.trim()))
        ) {
          errors.push(`${prefix}: copy.shortTitle 至少需要填写中文或英文（title 会自动同步）`);
        } else {
          // 确保 title 从 shortTitle 同步
          if (!c.copy.title) c.copy.title = {};
          if (!c.copy.title.zh && c.copy.shortTitle.zh) {
            c.copy.title.zh = c.copy.shortTitle.zh;
          }
          if (!c.copy.title.en && c.copy.shortTitle.en) {
            c.copy.title.en = c.copy.shortTitle.en;
          }
        }

        // 必填：copy.emoji
        if (!c.copy || !c.copy.emoji || !c.copy.emoji.trim()) {
          errors.push(`${prefix}: copy.emoji 不能为空`);
        }

        // 必填：copy.ctaText（至少一个语言）
        if (
          !c.copy ||
          !c.copy.ctaText ||
          typeof c.copy.ctaText !== "object" ||
          ((!c.copy.ctaText.zh || !c.copy.ctaText.zh.trim()) &&
            (!c.copy.ctaText.en || !c.copy.ctaText.en.trim()))
        ) {
          errors.push(`${prefix}: copy.ctaText 至少需要填写中文或英文`);
        }

        // 必填：links（至少 guideUrl 或 activeUrl 有一个）
        if (
          !c.links ||
          typeof c.links !== "object" ||
          ((!c.links.guideUrl || !c.links.guideUrl.trim()) &&
            (!c.links.activeUrl || !c.links.activeUrl.trim()))
        ) {
          errors.push(`${prefix}: links 的 guideUrl 或 activeUrl 至少需要填写一个`);
        }

        // 写作相关主题：至少一个
        if (
          !Array.isArray(c.writingThemes) ||
          c.writingThemes.length === 0
        ) {
          errors.push(`${prefix}: 写作相关主题（writingThemes）至少需要添加一个主题`);
        }

        // 新活动必填：奖励配置和门槛（如果活动中有这些字段的定义，则必须填写）
        // 判断是否为新活动：如果 rewardAmount、rewardParticipantCount、rewardDistributionType、threshold、includeCreator 中任意一个在对象中存在，则认为是新活动
        const hasNewFields =
          "rewardAmount" in c ||
          "rewardParticipantCount" in c ||
          "rewardDistributionType" in c ||
          "threshold" in c ||
          "includeCreator" in c;

        if (hasNewFields) {
          // 奖励金额（1-99999999）
          if (
            c.rewardAmount === undefined ||
            c.rewardAmount === null ||
            (typeof c.rewardAmount === "string" && c.rewardAmount.trim() === "") ||
            isNaN(Number(c.rewardAmount)) ||
            Number(c.rewardAmount) < 1 ||
            Number(c.rewardAmount) > 99999999
          ) {
            errors.push(`${prefix}: rewardAmount（奖励金额）必须填写，范围：1-99999999 U`);
          }

          // 人数（10-1000）
          if (
            c.rewardParticipantCount === undefined ||
            c.rewardParticipantCount === null ||
            (typeof c.rewardParticipantCount === "string" &&
              c.rewardParticipantCount.trim() === "") ||
            isNaN(Number(c.rewardParticipantCount)) ||
            Number(c.rewardParticipantCount) < 10 ||
            Number(c.rewardParticipantCount) > 1000
          ) {
            errors.push(`${prefix}: rewardParticipantCount（人数）必须填写，范围：10-1000 人`);
          }

          // 分配机制
          if (
            c.rewardDistributionType === undefined ||
            c.rewardDistributionType === null ||
            (typeof c.rewardDistributionType === "string" &&
              c.rewardDistributionType.trim() === "") ||
            !["equal", "mindshare"].includes(String(c.rewardDistributionType))
          ) {
            errors.push(`${prefix}: rewardDistributionType（分配机制）必须选择：平分 或 mindshare分`);
          }

          // 门槛（threshold 只能是 50000, 100000, 200000，如果选择 "200k+creator" 则 threshold 为 200000 且 includeCreator 为 true）
          const validThresholds = [50000, 100000, 200000];
          // 兼容老数据：也接受字符串格式
          const thresholdValue = typeof c.threshold === "string" 
            ? (c.threshold === "50k" ? 50000 : c.threshold === "100k" ? 100000 : c.threshold === "200k" ? 200000 : null)
            : c.threshold;
          if (
            c.threshold === undefined ||
            c.threshold === null ||
            (typeof c.threshold === "string" && c.threshold.trim() === "") ||
            (thresholdValue !== null && !validThresholds.includes(thresholdValue))
          ) {
            errors.push(
              `${prefix}: threshold（门槛）必须选择：50k / 100k / 200k / 200k+creator`
            );
          }
          // includeCreator 必须是布尔值
          if (c.includeCreator !== undefined && typeof c.includeCreator !== "boolean") {
            errors.push(`${prefix}: includeCreator 必须是布尔值（true/false）`);
          }
          // 如果 threshold 不是 200000，则 includeCreator 应该为 false（兼容老数据：也检查 "200k"）
          const is200k = thresholdValue === 200000 || c.threshold === "200k";
          if (!is200k && c.includeCreator === true) {
            errors.push(
              `${prefix}: includeCreator 只能在 threshold 为 200k 时设置为 true`
            );
          }
        }

        // 必填：tasks（至少一个任务）
        if (!Array.isArray(c.tasks) || c.tasks.length === 0) {
          errors.push(`${prefix}: 至少需要配置一个 task`);
        } else {
          // 检查每个 task 的必填字段
          c.tasks.forEach((task, taskIdx) => {
            // 自动生成 task id（如果还没有的话）
            if (!task.id || !task.id.trim()) {
              const campaignKey = c.campaignKey || "";
              const type = task?.type || "";
              const url = task?.url || "";
              if (campaignKey && type && url) {
                task.id = generateTaskId(campaignKey, type, url);
              }
            }
            // 如果 id 仍然为空，说明缺少必要字段
            if (!task.id || !task.id.trim()) {
              const missing = [];
              if (!c.campaignKey || !c.campaignKey.trim()) missing.push("campaignKey");
              if (!task.type || !task.type.trim()) missing.push("type");
              if (!task.url || !task.url.trim()) missing.push("url");
              errors.push(`${prefix}: task #${taskIdx + 1} 的 id 无法自动生成，缺少字段：${missing.join("、")}`);
            }
            if (
              !task.title ||
              typeof task.title !== "object" ||
              ((!task.title.zh || !task.title.zh.trim()) &&
                (!task.title.en || !task.title.en.trim()))
            ) {
              errors.push(`${prefix}: task #${taskIdx + 1} 的 title 至少需要填写中文或英文`);
            }
            if (!task.url || !task.url.trim()) {
              errors.push(`${prefix}: task #${taskIdx + 1} 的 url 不能为空`);
            }
          });
        }

        // 必填：logos（至少一个 logo）
        if (!Array.isArray(c.logos) || c.logos.length === 0) {
          errors.push(`${prefix}: 至少需要配置一个 logo`);
        } else {
          // 检查每个 logo 的必填字段
          c.logos.forEach((logo, logoIdx) => {
            if (!logo.image || !logo.image.trim()) {
              errors.push(`${prefix}: logo #${logoIdx + 1} 的 image 不能为空`);
            }
            if (!logo.url || !logo.url.trim()) {
              errors.push(`${prefix}: logo #${logoIdx + 1} 的 url 不能为空`);
            }
            if (!logo.label || !logo.label.trim()) {
              errors.push(`${prefix}: logo #${logoIdx + 1} 的 label 不能为空`);
            }
          });
        }
      });

      return {
        valid: errors.length === 0,
        errors,
      };
    }

    async function publish() {
      // 先验证所有活动
      const validation = validateCampaigns();
      if (!validation.valid) {
        const errorMsg =
          "发布失败：以下必填字段未填写完整：\n\n" +
          validation.errors.join("\n") +
          "\n\n请完善所有必填字段后再发布。";
        toast(errorMsg, "error");
        // 使用 alert 显示完整错误信息（因为 toast 可能显示不全）
        window.alert(errorMsg);
        return;
      }

      const content = JSON.stringify(config, null, 2);
      // 显示预览模态框
      showJsonPreviewModal(content);
    }

    function showJsonPreviewModal(jsonContent) {
      const modal = $("campaigns-json-preview-modal");
      const contentEl = $("campaigns-json-preview-content");
      const dataIdEl = $("campaigns-json-preview-dataid");
      const diffHintEl = $("campaigns-json-preview-diff-hint");
      if (!modal || !contentEl) return;

      if (dataIdEl) dataIdEl.textContent = DATA_ID;

      let currentObj;
      try {
        currentObj = JSON.parse(jsonContent);
      } catch (e) {
        contentEl.textContent = jsonContent;
        if (diffHintEl) diffHintEl.textContent = "（JSON 解析失败，显示原文）";
        modal.style.display = "flex";
        return;
      }

      const originalObj = originalConfig || {};
      const diff = typeof Diff !== "undefined" && Diff.diffJson
        ? Diff.diffJson(originalObj, currentObj)
        : null;

      if (diff && diff.length > 0) {
        const fragment = document.createDocumentFragment();
        diff.forEach((part) => {
          const span = document.createElement("span");
          span.className = part.added ? "added" : part.removed ? "removed" : "";
          span.appendChild(document.createTextNode(part.value));
          fragment.appendChild(span);
        });
        contentEl.innerHTML = "";
        contentEl.appendChild(fragment);
      } else {
        contentEl.textContent = jsonContent;
      }

      if (diffHintEl) {
        if (originalConfig) {
          diffHintEl.textContent = "（与当前 Nacos 对比）";
        } else {
          diffHintEl.textContent = "（首次发布，无原始配置）";
        }
      }

      modal.style.display = "flex";
    }

    function hideJsonPreviewModal() {
      const modal = $("campaigns-json-preview-modal");
      if (modal) modal.style.display = "none";
    }

    async function confirmPublish() {
      hideJsonPreviewModal();
      const content = JSON.stringify(config, null, 2);
      toast("正在发布到 Nacos...", "info");
      await apiPublishConfig({ dataId: DATA_ID, content, group: GROUP });
      dirty = false;
      $("campaigns-publish").disabled = true;
      // 更新 originalConfig 为当前 config，清空变动项
      originalConfig = JSON.parse(JSON.stringify(config));
      toast("发布成功", "success");
    }

    function init() {
      if (inited) return;
      inited = true;

      // init base
      $("campaigns-publish").disabled = true;
      setControlsEnabled(false);
      setEditorInputsEnabled(false);
      clearWebsiteConfigEditor("请先选择活动");

      bindInputSync();
      bindRepeatersEvents();

      // 折叠功能（处理所有折叠section）
      const collapsibleSections = document.querySelectorAll(".section-collapsible");
      collapsibleSections.forEach((section) => {
        const title = section.querySelector(".section-title-collapsible");
        const content = section.querySelector(".section-content");
        if (title && content) {
          title.addEventListener("click", () => {
            const isExpanded = section.classList.contains("expanded");
            if (isExpanded) {
              section.classList.remove("expanded");
              content.style.display = "none";
            } else {
              section.classList.add("expanded");
              content.style.display = "block";
            }
          });
        }
      });

      // 早期项目提示hover预览功能
      const riskPreviewTrigger = document.querySelector(".risk-preview-trigger");
      const riskPreviewPopup = $("risk-preview-popup");
      if (riskPreviewTrigger && riskPreviewPopup) {
        let hoverTimeout = null;
        const showPopup = (e) => {
          if (hoverTimeout) clearTimeout(hoverTimeout);
          const rect = e.target.getBoundingClientRect();
          riskPreviewPopup.style.display = "block";
          riskPreviewPopup.style.left = rect.left + "px";
          riskPreviewPopup.style.top = (rect.bottom + 8) + "px";
          // 确保不超出屏幕右边界
          const popupRect = riskPreviewPopup.getBoundingClientRect();
          if (popupRect.right > window.innerWidth) {
            riskPreviewPopup.style.left = (window.innerWidth - popupRect.width - 10) + "px";
          }
        };
        const hidePopup = () => {
          hoverTimeout = setTimeout(() => {
            riskPreviewPopup.style.display = "none";
          }, 100);
        };
        riskPreviewTrigger.addEventListener("mouseenter", showPopup);
        riskPreviewTrigger.addEventListener("mouseleave", hidePopup);
        riskPreviewPopup.addEventListener("mouseenter", () => {
          if (hoverTimeout) clearTimeout(hoverTimeout);
        });
        riskPreviewPopup.addEventListener("mouseleave", hidePopup);
      }

      $("campaigns-search").addEventListener("input", (e) => {
        search = e.target.value || "";
        renderList();
      });

      const LIST_COLLAPSED_KEY = "nacos-campaigns-list-collapsed";
      const campaignsRoot = $("nacos-campaigns") || document.body;
      const bodyEl = campaignsRoot.querySelector(".campaigns-body");
      const listToggleBtn = $("campaigns-list-toggle");
      function applyListCollapsed(collapsed) {
        if (!bodyEl) return;
        if (collapsed) {
          bodyEl.classList.add("list-collapsed");
          if (listToggleBtn) {
            listToggleBtn.title = "展开列表";
            listToggleBtn.setAttribute("aria-label", "展开列表");
          }
        } else {
          bodyEl.classList.remove("list-collapsed");
          if (listToggleBtn) {
            listToggleBtn.title = "收起列表";
            listToggleBtn.setAttribute("aria-label", "收起列表");
          }
        }
        try { localStorage.setItem(LIST_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch (_) {}
      }
      if (bodyEl && listToggleBtn) {
        const savedCollapsed = typeof localStorage !== "undefined" && localStorage.getItem(LIST_COLLAPSED_KEY) === "1";
        applyListCollapsed(savedCollapsed);
        listToggleBtn.addEventListener("click", () => {
          const collapsed = bodyEl.classList.toggle("list-collapsed");
          applyListCollapsed(collapsed);
        });
      }

      $("campaigns-refresh").addEventListener("click", async () => {
        if (!confirmDiscardWebsiteConfigChanges()) return;
        if (dirty) {
          const ok = window.confirm(
            "你当前有未发布的修改，重新加载会丢失这些修改。\n确认重新加载？"
          );
          if (!ok) return;
        }
        try {
          await loadFromNacos();
        } catch (e) {
          toast("加载失败：" + (e.message || "未知错误"), "error");
        }
      });

      $("campaigns-new").addEventListener("click", () => {
        newCampaign();
      });
      $("campaigns-duplicate").addEventListener("click", duplicateCampaign);
      $("campaigns-delete").addEventListener("click", deleteCampaign);

      $("campaigns-publish").addEventListener("click", () => {
        publish().catch((e) => toast("发布失败：" + e.message, "error"));
      });

      const syncWebsiteBtn = $("campaigns-sync-website");
      if (syncWebsiteBtn) {
        syncWebsiteBtn.addEventListener("click", async () => {
          try {
            syncWebsiteBtn.disabled = true;
            toast("正在同步到网站数据库...", "info");
            const result = await apiSyncWebsiteCampaigns(false);
            websiteCampaignRecords = await apiListAllWebsiteCampaigns();
            renderList();
            const summary = result.summary || {};
            toast(`同步完成：新增 ${summary.created || 0}，更新 ${summary.updated || 0}，本次从 Nacos 删除 ${summary.softDeleted || 0}`, "success");
            if (getCurrentWebsiteTarget() && (getCurrentWebsiteTarget().id || getCurrentWebsiteTarget().nacosCampaignId)) {
              await loadWebsiteConfigForCurrentCampaign();
            }
          } catch (e) {
            toast("同步失败：" + (e.message || "未知错误"), "error");
          } finally {
            syncWebsiteBtn.disabled = false;
          }
        });
      }

      const formatTemplateBtn = $("campaigns-templateConfig-format");
      if (formatTemplateBtn) {
        formatTemplateBtn.disabled = false;
        formatTemplateBtn.addEventListener("click", () => {
          try {
            formatTemplateConfigEditor();
            toast("templateConfig 已格式化", "success");
          } catch (e) {
            toast("templateConfig 格式化失败：" + (e.message || "未知错误"), "error");
          }
        });
      }

      const copyTemplateBtn = $("campaigns-templateConfig-copy");
      if (copyTemplateBtn) {
        copyTemplateBtn.disabled = false;
        copyTemplateBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText($("campaigns-templateConfig").value || "{}");
            toast("templateConfig 已复制", "success");
          } catch (e) {
            toast("复制失败，请手动复制", "error");
          }
        });
      }

      const saveWebsiteBtn = $("campaigns-save-website");
      if (saveWebsiteBtn) {
        saveWebsiteBtn.addEventListener("click", async () => {
          try {
            saveWebsiteBtn.disabled = true;
            toast("正在保存网站配置...", "info");
            await saveWebsiteConfig();
            toast("网站配置保存成功", "success");
          } catch (e) {
            toast("保存网站配置失败：" + (e.message || "未知错误"), "error");
          } finally {
            saveWebsiteBtn.disabled = false;
          }
        });
      }

      $("campaigns-logos-add").addEventListener("click", addLogo);
      $("campaigns-tasks-add").addEventListener("click", addTask);
      const essayWinnersAddBtn = $("campaigns-essay-winners-add");
      if (essayWinnersAddBtn) {
        essayWinnersAddBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          addEssayContestWinner();
        });
      }
      const writingThemesAddBtn = $("campaigns-writing-themes-add");
      if (writingThemesAddBtn) {
        writingThemesAddBtn.addEventListener("click", addWritingTheme);
      }
      const tagsAddBtn = $("campaigns-tags-add");
      if (tagsAddBtn) {
        tagsAddBtn.addEventListener("click", addTag);
      }

      // JSON 预览模态框事件绑定
      const previewModal = $("campaigns-json-preview-modal");
      const previewModalClose = $("campaigns-json-preview-modal-close");
      const previewModalCancel = $("campaigns-json-preview-modal-cancel");
      const previewModalConfirm = $("campaigns-json-preview-modal-confirm");

      if (previewModalClose) {
        previewModalClose.addEventListener("click", hideJsonPreviewModal);
      }
      if (previewModalCancel) {
        previewModalCancel.addEventListener("click", hideJsonPreviewModal);
      }
      if (previewModalConfirm) {
        previewModalConfirm.addEventListener("click", () => {
          confirmPublish().catch((e) => toast("发布失败：" + e.message, "error"));
        });
      }
      // 点击遮罩层关闭
      if (previewModal) {
        previewModal.addEventListener("click", (e) => {
          if (e.target === previewModal) {
            hideJsonPreviewModal();
          }
        });
      }
      // 按 ESC 键关闭
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && previewModal && previewModal.style.display === "flex") {
          hideJsonPreviewModal();
        }
      });

      // first load
      loadFromNacos().catch((e) => toast("加载失败：" + e.message, "error"));
    }

    function tryInitIfActive() {
      const pane = document.getElementById("nacos-campaigns");
      if (pane && pane.classList.contains("active")) {
        setTimeout(init, 30);
      }
    }

    document.addEventListener("click", function (e) {
      const tabBtn = e.target.closest(".tab-btn");
      if (tabBtn && tabBtn.getAttribute("data-tab") === "nacos-campaigns") {
        setTimeout(init, 80);
      }
    });

    document.addEventListener("DOMContentLoaded", tryInitIfActive);
    setTimeout(tryInitIfActive, 300);
}
