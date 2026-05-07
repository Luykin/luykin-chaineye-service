// Tab 切换功能
// 获取本地日期字符串（格式：YYYY-MM-DD）
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 初始化所有日期选择器为今天（使用本地时区）
function initDatePickers() {
  const today = getLocalDateString();
  const datePickerIds = [
    "rootdata-date-picker",
    "notes-date",
    "dau-date-selector",
    "start-date",
    "end-date",
  ];

  datePickerIds.forEach((id) => {
    const datePicker = document.getElementById(id);
    if (datePicker && !datePicker.value) {
      datePicker.value = today;
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 DOMContentLoaded 事件触发");

  try {
    // 初始化所有日期选择器
    initDatePickers();

    // 渲染侧边栏 Tab（按权限排序）
    renderSidebarTabs();

    // 初始化 Tab 功能
    initTabs();

    // 绑定下载按钮事件
    bindDownloadEvents();

    // 绑定数据导出按钮事件
    bindExportEvents();

    // 绑定 Rootdata 页面事件
    bindRootdataEvents();

    // 绑定 Pro 用户管理事件
    bindProManagementEvents();

    // 绑定 数据库备份 事件
    bindBackupEvents();

    // 绑定评论管理事件
    bindReviewsManagementEvents();

    // 绑定 Redis 管理事件
    bindRedisManagementEvents();

    // 绑定 LLM 测试事件
    bindLlmTestEvents();

    console.log("✅ 所有初始化完成");
  } catch (error) {
    console.error("❌ 初始化过程中出错:", error);
  }
});

// 初始化 Tab 功能
function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const perms = Array.isArray(window.adminPermissions)
    ? window.adminPermissions
    : [];

  // Tab -> permission 映射（无映射则默认允许）
  const tabPermMap = {
    "dau-details": "dau-details",
    "online-users": "online-users",
    cohorts: "cohorts",
    rootdata: "rootdata",
    notes: "notes",
    "log-search": "log-search:read",
    "device-monitor": "device-status:read",
    "version-stats": "version-stats",
    "url-stats": "url-stats",
    "security-violations": "security-violations",
    messages: "messages",
    "data-export": "export:users",
    "reviews-management": "reviews-management",
    "pro-management": "pro-management",
    "perf-monitor": "perf-monitor",
    backup: "backup:operate",
    "server-command": "server:execute",
    "daily-report-email": "daily-report:send",
    "admin-audit-logs": "audit-logs:read",
    "nacos-messages": "nacos-messages",
    "nacos-campaigns": "nacos_config",
    "nacos-tags": "nacos-tags",
    "feature-flags": "feature_flags_config",
    "redis-management": "redis-management",
    "llm-test": "llm-test",
  };

  function hasPermissionForTab(tab) {
    const need = tabPermMap[tab];
    if (!need) return true; // 未配置则默认放行
    if (perms.includes("*")) return true;
    return perms.includes(need);
  }

  tabBtns.forEach((btn) => {
    // 跳过快速链接按钮
    if (btn.classList.contains("quick-link")) return;

    btn.addEventListener("click", function () {
      const tabId = this.getAttribute("data-tab");
      if (!tabId) return;

      // 权限检查
      if (!hasPermissionForTab(tabId)) {
        alert("您没有权限访问此功能");
        return;
      }

      // 移除所有 active 状态
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      // 添加当前 active 状态
      this.classList.add("active");
      const targetPane = document.getElementById(tabId);
      if (targetPane) {
        targetPane.classList.add("active");
      }

      // 保存当前选中的 tab 到 sessionStorage
      sessionStorage.setItem("activeTab", tabId);

      // 触发 Tab 特定的初始化
      handleTabInit(tabId);

      // 触发 stats-tab-activated 事件（供各页面加载数据）
      document.dispatchEvent(new CustomEvent('stats-tab-activated', { 
        detail: { tabId: tabId } 
      }));

      // 添加到最近访问
      addToRecentTabs(tabId);
    });
  });

  // 初始化最近访问 Tab 栏
  initRecentTabs();

  // 恢复上次选中的 tab
  const savedTab = sessionStorage.getItem("activeTab");
  if (savedTab) {
    const targetBtn = document.querySelector(`[data-tab="${savedTab}"]`);
    if (targetBtn && !targetBtn.classList.contains("quick-link")) {
      // 检查权限
      if (hasPermissionForTab(savedTab)) {
        targetBtn.click();
      }
    }
  }
}

// 处理 Tab 特定的初始化
function handleTabInit(tabId) {
  switch (tabId) {
    case "redis-management":
      initRedisManagement();
      break;
    case "pro-management":
      initProManagement();
      break;
    case "reviews-management":
      initReviewsManagement();
      break;
    // ... 其他 Tab 的初始化
  }
}

// ==================== Redis 管理功能 ====================

// Redis 管理状态
let redisCurrentKey = null;
let redisCurrentData = null;
const REDIS_HISTORY_KEY = "redis_query_history";
const MAX_HISTORY_ITEMS = 20;

/**
 * 绑定 Redis 管理事件
 */
function bindRedisManagementEvents() {
  // 查询按钮
  const queryBtn = document.getElementById("redis-query-btn");
  if (queryBtn) {
    queryBtn.addEventListener("click", () => handleRedisQuery());
  }

  // 回车键查询
  const keyInput = document.getElementById("redis-key-input");
  if (keyInput) {
    keyInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleRedisQuery();
    });
  }

  // 重置按钮
  const resetBtn = document.getElementById("redis-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetRedisQuery);
  }

  // 扫描 Keys 按钮
  const scanBtn = document.getElementById("redis-scan-btn");
  if (scanBtn) {
    scanBtn.addEventListener("click", handleRedisScan);
  }

  // 刷新服务器信息
  const refreshBtn = document.getElementById("redis-refresh-info");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadRedisInfo);
  }

  // 编辑按钮
  const editBtn = document.getElementById("redis-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", showRedisEditModal);
  }

  // 删除按钮
  const deleteBtn = document.getElementById("redis-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", showRedisDeleteModal);
  }

  // 复制按钮
  const copyBtn = document.getElementById("redis-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyRedisValue);
  }

  // 编辑对话框事件
  const editModalClose = document.getElementById("redis-edit-modal-close");
  const editCancel = document.getElementById("redis-edit-cancel");
  const editSave = document.getElementById("redis-edit-save");

  if (editModalClose) editModalClose.addEventListener("click", hideRedisEditModal);
  if (editCancel) editCancel.addEventListener("click", hideRedisEditModal);
  if (editSave) editSave.addEventListener("click", handleRedisUpdate);

  // 删除对话框事件
  const deleteModalClose = document.getElementById("redis-delete-modal-close");
  const deleteCancel = document.getElementById("redis-delete-cancel");
  const deleteConfirm = document.getElementById("redis-delete-confirm");

  if (deleteModalClose) deleteModalClose.addEventListener("click", hideRedisDeleteModal);
  if (deleteCancel) deleteCancel.addEventListener("click", hideRedisDeleteModal);
  if (deleteConfirm) deleteConfirm.addEventListener("click", handleRedisDelete);

  // 清空历史
  const clearHistoryBtn = document.getElementById("redis-clear-history");
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", clearRedisHistory);
  }
}

/**
 * 初始化 Redis 管理页面
 */
function initRedisManagement() {
  loadRedisInfo();
  renderRedisHistory();
}

/**
 * 加载 Redis 服务器信息
 */
async function loadRedisInfo() {
  try {
    const response = await fetch("/admin/system/redis/info");
    const result = await response.json();

    if (result.success && result.data) {
      const data = result.data;
      document.getElementById("redis-version").textContent = data.version || "-";
      document.getElementById("redis-mode").textContent = data.mode || "-";
      const keysEl = document.getElementById("redis-keys");
      const keysFormatted = formatCompactNumber(data.totalKeys);
      keysEl.textContent = keysFormatted;
      keysEl.title = formatNumber(data.totalKeys) + " keys";
      document.getElementById("redis-memory").textContent = data.usedMemory || "-";
      document.getElementById("redis-clients").textContent = data.connectedClients || "-";

      // 计算命中率
      const hits = data.keyspaceHits || 0;
      const misses = data.keyspaceMisses || 0;
      const total = hits + misses;
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(2) + "%" : "-";
      document.getElementById("redis-hitrate").textContent = hitRate;
    }
  } catch (error) {
    console.error("加载 Redis 信息失败:", error);
  }
}

/**
 * 查询 Redis Key
 */
async function handleRedisQuery(key = null) {
  const keyInput = document.getElementById("redis-key-input");
  const queryKey = key || keyInput.value.trim();

  if (!queryKey) {
    alert("请输入 Key");
    return;
  }

  try {
    const response = await fetch(`/admin/system/redis/query?key=${encodeURIComponent(queryKey)}`);
    const result = await response.json();

    if (result.success) {
      if (result.data) {
        redisCurrentKey = result.data.key;
        redisCurrentData = result.data;
        displayRedisResult(result.data);
        addRedisHistory(queryKey);
      } else {
        alert("Key 不存在");
        hideRedisResult();
      }
    } else {
      alert(result.error || "查询失败");
    }
  } catch (error) {
    console.error("查询 Redis 失败:", error);
    alert("查询失败: " + error.message);
  }
}

/**
 * 扫描 Redis Keys
 */
async function handleRedisScan() {
  const patternInput = document.getElementById("redis-pattern-input");
  const pattern = patternInput.value.trim() || "*";

  try {
    const response = await fetch(`/admin/system/redis/keys?pattern=${encodeURIComponent(pattern)}&count=100`);
    const result = await response.json();

    if (result.success && result.data) {
      displayRedisKeysList(result.data.keys);
    } else {
      alert(result.error || "扫描失败");
    }
  } catch (error) {
    console.error("扫描 Redis Keys 失败:", error);
    alert("扫描失败: " + error.message);
  }
}

/**
 * 显示 Keys 列表
 */
function displayRedisKeysList(keys) {
  const listContainer = document.getElementById("redis-keys-list");
  const tbody = document.getElementById("redis-keys-tbody");

  if (!keys || keys.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 16px; color: #9ca3af;">未找到匹配的 Key</td></tr>';
    listContainer.style.display = "block";
    return;
  }

  tbody.innerHTML = keys
    .map(
      (key) => `
    <tr>
      <td>${escapeHtml(key)}</td>
      <td class="col-action">
        <button class="redis-btn redis-btn-secondary" style="height: 28px; padding: 0 10px; font-size: 0.75rem;" onclick="handleRedisQuery('${escapeHtml(key)}')">查询</button>
      </td>
    </tr>
  `
    )
    .join("");

  listContainer.style.display = "block";
}

/**
 * 显示查询结果
 */
function displayRedisResult(data) {
  const resultArea = document.getElementById("redis-result-area");
  const emptyState = document.getElementById("redis-empty-state");
  const warningBadge = document.getElementById("redis-warning-badge");
  const editBtn = document.getElementById("redis-edit-btn");

  // 填充基本信息
  document.getElementById("redis-result-key").textContent = data.key;
  document.getElementById("redis-result-type").innerHTML = `<span class="badge badge-type">${data.type}</span>`;
  document.getElementById("redis-result-ttl").textContent =
    data.ttl !== null ? formatDuration(data.ttl) : "永不过期";
  document.getElementById("redis-result-size").textContent = formatBytes(data.size);
  document.getElementById("redis-result-length").textContent = data.length || "-";

  // 填充 Value
  const valueTextarea = document.getElementById("redis-result-value");
  valueTextarea.value = data.value || "";

  // 显示 JSON 标签
  const jsonBadge = document.getElementById("redis-value-type-badge");
  jsonBadge.style.display = data.isJson ? "inline-flex" : "none";

  // 敏感 Key 警告
  warningBadge.style.display = data.isSensitive ? "flex" : "none";

  // 所有类型都可以编辑，但非 string 类型需要谨慎
  editBtn.style.display = "inline-flex";
  if (data.type !== "string") {
    editBtn.title = `注意：${data.type} 类型数据以 JSON 格式编辑，请谨慎操作`;
  } else {
    editBtn.title = "";
  }

  // 显示结果，隐藏空状态
  resultArea.style.display = "flex";
  if (emptyState) emptyState.style.display = "none";
}

/**
 * 隐藏查询结果
 */
function hideRedisResult() {
  const resultArea = document.getElementById("redis-result-area");
  const emptyState = document.getElementById("redis-empty-state");
  resultArea.style.display = "none";
  if (emptyState) emptyState.style.display = "flex";
  redisCurrentKey = null;
  redisCurrentData = null;
}

/**
 * 重置查询
 */
function resetRedisQuery() {
  document.getElementById("redis-key-input").value = "";
  hideRedisResult();
  document.getElementById("redis-keys-list").style.display = "none";
}

/**
 * 显示编辑对话框
 */
function showRedisEditModal() {
  if (!redisCurrentData) return;

  const isString = redisCurrentData.type === "string";
  const valueEl = document.getElementById("redis-edit-value");
  
  document.getElementById("redis-edit-key").textContent = redisCurrentData.key;
  
  // String 类型直接显示文本，其他类型显示 JSON
  if (isString) {
    valueEl.value = redisCurrentData.value || "";
  } else {
    // 非 String 类型以 JSON 格式显示，便于编辑
    try {
      valueEl.value = JSON.stringify(redisCurrentData.parsedValue || redisCurrentData.value, null, 2);
    } catch (e) {
      valueEl.value = redisCurrentData.value || "";
    }
  }
  
  // 预填当前 TTL（秒），如果是永不过期则留空
  const currentTtlSeconds = redisCurrentData.ttl;
  if (currentTtlSeconds > 0) {
    document.getElementById("redis-edit-ttl").value = currentTtlSeconds;
  } else {
    document.getElementById("redis-edit-ttl").value = "";
  }
  document.getElementById("redis-edit-current-ttl").textContent =
    currentTtlSeconds !== null && currentTtlSeconds > 0 ? formatDuration(currentTtlSeconds) : "永不过期"; 
  
  // 保存当前 TTL 到 data 属性，用于提交时判断
  document.getElementById("redis-edit-ttl").dataset.currentTtl = currentTtlSeconds || ""; 
  document.getElementById("redis-edit-ttl").placeholder = "留空保持原 TTL，-1 表示永不过期";
  
  // 添加类型提示
  const typeHint = document.getElementById("redis-edit-type-hint");
  if (typeHint) {
    typeHint.textContent = isString ? "" : `类型: ${redisCurrentData.type}（JSON 格式）`;
    typeHint.style.display = isString ? "none" : "block";
  }

  document.getElementById("redis-edit-modal").style.display = "flex";
}

/**
 * 隐藏编辑对话框
 */
function hideRedisEditModal() {
  document.getElementById("redis-edit-modal").style.display = "none";
}

/**
 * 更新 Redis Value
 */
async function handleRedisUpdate() {
  if (!redisCurrentKey || !redisCurrentData) return;

  const valueInput = document.getElementById("redis-edit-value").value;
  const ttlInput = document.getElementById("redis-edit-ttl").value;
  const ttl = ttlInput ? parseInt(ttlInput, 10) : null;
  
  const isString = redisCurrentData.type === "string";
  
  // 构造请求体
  const body = { 
    key: redisCurrentKey, 
    type: redisCurrentData.type,
    ttl 
  };
  
  // String 类型直接传 value，其他类型尝试解析 JSON
  if (isString) {
    body.value = valueInput;
  } else {
    try {
      body.value = JSON.parse(valueInput);
    } catch (e) {
      alert(`JSON 格式错误: ${e.message}`);
      return;
    }
  }

  try {
    const response = await fetch("/admin/system/redis/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (result.success) {
      alert("更新成功");
      hideRedisEditModal();
      // 重新查询刷新显示
      handleRedisQuery(redisCurrentKey);
    } else {
      alert(result.error || "更新失败");
    }
  } catch (error) {
    console.error("更新 Redis 失败:", error);
    alert("更新失败: " + error.message);
  }
}

/**
 * 显示删除对话框
 */
function showRedisDeleteModal() {
  if (!redisCurrentKey) return;

  document.getElementById("redis-delete-key").textContent = redisCurrentKey;
  document.getElementById("redis-delete-modal").style.display = "flex";
}

/**
 * 隐藏删除对话框
 */
function hideRedisDeleteModal() {
  document.getElementById("redis-delete-modal").style.display = "none";
}

/**
 * 删除 Redis Key
 */
async function handleRedisDelete() {
  if (!redisCurrentKey) return;

  try {
    const response = await fetch("/admin/system/redis/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: redisCurrentKey }),
    });

    const result = await response.json();

    if (result.success) {
      alert("删除成功");
      hideRedisDeleteModal();
      hideRedisResult();
      document.getElementById("redis-key-input").value = "";
    } else {
      alert(result.error || "删除失败");
    }
  } catch (error) {
    console.error("删除 Redis Key 失败:", error);
    alert("删除失败: " + error.message);
  }
}

/**
 * 复制 Value 到剪贴板
 */
async function copyRedisValue() {
  const valueTextarea = document.getElementById("redis-result-value");
  if (!valueTextarea.value) return;

  try {
    await navigator.clipboard.writeText(valueTextarea.value);
    alert("已复制到剪贴板");
  } catch (error) {
    // 降级方案
    valueTextarea.select();
    document.execCommand("copy");
    alert("已复制到剪贴板");
  }
}

/**
 * 添加查询历史
 */
function addRedisHistory(key) {
  let history = JSON.parse(localStorage.getItem(REDIS_HISTORY_KEY) || "[]");

  // 去重并移动到最前面
  history = history.filter((item) => item !== key);
  history.unshift(key);

  // 限制数量
  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(0, MAX_HISTORY_ITEMS);
  }

  localStorage.setItem(REDIS_HISTORY_KEY, JSON.stringify(history));
  renderRedisHistory();
}

/**
 * 渲染查询历史
 */
function renderRedisHistory() {
  const container = document.getElementById("redis-history-list");
  const history = JSON.parse(localStorage.getItem(REDIS_HISTORY_KEY) || "[]");

  if (history.length === 0) {
    container.innerHTML = '<span class="empty-text">暂无记录</span>';
    return;
  }

  container.innerHTML = history
    .map(
      (key) => `
    <div class="history-item">
      <span class="history-item-key" data-action="copy" data-key="${escapeHtml(key)}" title="点击复制">${escapeHtml(key)}</span>
      <div class="history-item-actions">
        <button class="btn-text" data-action="query" data-key="${escapeHtml(key)}">查询</button>
        <button class="btn-text" data-action="delete" data-key="${escapeHtml(key)}">删除</button>
      </div>
    </div>
  `
    )
    .join("");

  // 事件委托 - 绑定在容器上
  container.onclick = function(e) {
    const target = e.target;
    const key = target.getAttribute('data-key');
    if (!key) return;
    
    const action = target.getAttribute('data-action');
    
    if (action === 'copy') {
      copyToClipboard(key);
    } else if (action === 'query') {
      document.getElementById('redis-key-input').value = key;
      handleRedisQuery(key);
    } else if (action === 'delete') {
      removeRedisHistory(key);
    }
  };
}

/**
 * 移除单个历史记录
 */
function removeRedisHistory(key) {
  let history = JSON.parse(localStorage.getItem(REDIS_HISTORY_KEY) || "[]");
  history = history.filter((item) => item !== key);
  localStorage.setItem(REDIS_HISTORY_KEY, JSON.stringify(history));
  renderRedisHistory();
}

/**
 * 清空历史记录
 */
function clearRedisHistory() {
  if (confirm("确定要清空所有查询历史吗？")) {
    localStorage.removeItem(REDIS_HISTORY_KEY);
    renderRedisHistory();
  }
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * 格式化时长（秒转为可读格式）
 */
function formatDuration(seconds) {
  if (seconds < 60) return seconds + " 秒";
  if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " 小时";
  return Math.floor(seconds / 86400) + " 天";
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  return num?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || "0";
}

/**
 * 格式化数字为紧凑形式 (1.2K, 3.5M, 2.1B)
 */
/**
 * 复制文本到剪贴板
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    // 显示提示
    const toast = document.createElement('div');
    toast.textContent = '已复制: ' + text.substring(0, 30) + (text.length > 30 ? '...' : '');
    toast.style.cssText = 'position:fixed;right:20px;bottom:80px;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;animation:fadeIn 0.2s ease;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  } catch (err) {
    // 降级方案
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

function formatCompactNumber(num) {
  if (!num || num === 0) return "0";
  const absNum = Math.abs(num);
  if (absNum < 1000) return num.toString();
  if (absNum < 1000000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  if (absNum < 1000000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  return (num / 1000000000).toFixed(1).replace(/\.0$/, "") + "B";
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 其他功能函数（保持原有代码）====================

// 绑定下载按钮事件
function bindDownloadEvents() {
  // 设备监控数据下载
  const downloadDeviceBtn = document.getElementById("download-device-csv");
  if (downloadDeviceBtn) {
    downloadDeviceBtn.addEventListener("click", function () {
      const table = document.getElementById("device-data-table");
      if (!table) return;
      downloadTableAsCSV(table, "device_monitor_data.csv");
    });
  }
}

// 绑定数据导出按钮事件
function bindExportEvents() {
  // 用户数据导出
  const exportUsersBtn = document.getElementById("export-users-btn");
  if (exportUsersBtn) {
    exportUsersBtn.addEventListener("click", async function () {
      const startDate = document.getElementById("start-date").value;
      const endDate = document.getElementById("end-date").value;

      if (!startDate || !endDate) {
        alert("请选择开始和结束日期");
        return;
      }

      try {
        const response = await fetch(
          `/api/xhunt/stats/export/users?startDate=${startDate}&endDate=${endDate}`
        );
        const data = await response.json();

        if (data.success) {
          downloadJSON(data.data, `users_${startDate}_${endDate}.json`);
        } else {
          alert(data.error || "导出失败");
        }
      } catch (error) {
        console.error("导出用户数据失败:", error);
        alert("导出失败");
      }
    });
  }
}

// 绑定 Rootdata 事件
function bindRootdataEvents() {
  const searchBtn = document.getElementById("rootdata-search-btn");
  if (searchBtn) {
    searchBtn.addEventListener("click", handleRootdataSearch);
  }
}

// 绑定评论管理事件
function bindReviewsManagementEvents() {
  const loadBtn = document.getElementById("reviews-load-btn");
  if (loadBtn) {
    loadBtn.addEventListener("click", loadReviewsList);
  }
}

// 绑定 Pro 用户管理事件
function bindProManagementEvents() {
  const loadBtn = document.getElementById("pro-load-btn");
  if (loadBtn) {
    loadBtn.addEventListener("click", () => loadProUsersList(1));
  }
}

// 绑定备份事件
function bindBackupEvents() {
  const backupBtn = document.getElementById("backup-now-btn");
  if (backupBtn) {
    backupBtn.addEventListener("click", handleBackupNow);
  }
}

// 导出表格为 CSV
function downloadTableAsCSV(table, filename) {
  const rows = table.querySelectorAll("tr");
  const csv = [];

  rows.forEach((row) => {
    const cols = row.querySelectorAll("td, th");
    const rowData = [];
    cols.forEach((col) => {
      let data = col.textContent.replace(/"/g, '""');
      rowData.push('"' + data + '"');
    });
    csv.push(rowData.join(","));
  });

  const csvContent = "\uFEFF" + csv.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// 导出 JSON 文件
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// Rootdata 搜索
async function handleRootdataSearch() {
  const idInput = document.getElementById("rootdata-id-input");
  const typeSelect = document.getElementById("rootdata-type-select");
  const resultArea = document.getElementById("rootdata-result-area");

  const id = idInput.value.trim();
  const type = typeSelect.value;

  if (!id) {
    alert("请输入 ID");
    return;
  }

  try {
    const response = await fetch(`/api/rootdatapro/internal/query_by_id?type=${type}&id=${id}`);
    const result = await response.json();

    if (result.success) {
      if (result.data) {
        resultArea.innerHTML = "<pre>" + JSON.stringify(result.data, null, 2) + "</pre>";
        resultArea.style.display = "block";
      } else {
        resultArea.innerHTML = "<p>未找到数据</p>";
        resultArea.style.display = "block";
      }
    } else {
      alert(result.error || "查询失败");
    }
  } catch (error) {
    console.error("Rootdata 查询失败:", error);
    alert("查询失败");
  }
}

// 加载评论列表
async function loadReviewsList() {
  const container = document.getElementById("reviews-list-container");
  if (!container) return;

  container.innerHTML = "<p>加载中...</p>";

  try {
    const response = await fetch("/api/admin/reviews/list");
    const result = await response.json();

    if (result.success) {
      renderReviewsList(result.data);
    } else {
      container.innerHTML = "<p>加载失败</p>";
    }
  } catch (error) {
    console.error("加载评论列表失败:", error);
    container.innerHTML = "<p>加载失败</p>";
  }
}

// 渲染评论列表
function renderReviewsList(data) {
  const container = document.getElementById("reviews-list-container");
  if (!data || data.length === 0) {
    container.innerHTML = "<p>暂无数据</p>";
    return;
  }

  // 简化的渲染逻辑
  container.innerHTML = "<p>已加载 " + data.length + " 条评论</p>";
}

// 初始化评论管理
function initReviewsManagement() {
  loadReviewsList();
}

// 加载 Pro 用户列表
async function loadProUsersList(page = 1) {
  const container = document.getElementById("pro-list-container");
  if (!container) return;

  container.innerHTML = "<p>加载中...</p>";

  try {
    const response = await fetch(`/api/admin/pro-users/list?page=${page}`);
    const result = await response.json();

    if (result.success) {
      renderProUsersList(result.data);
    } else {
      container.innerHTML = "<p>加载失败</p>";
    }
  } catch (error) {
    console.error("加载 Pro 用户列表失败:", error);
    container.innerHTML = "<p>加载失败</p>";
  }
}

// 渲染 Pro 用户列表
function renderProUsersList(data) {
  const container = document.getElementById("pro-list-container");
  if (!data || data.length === 0) {
    container.innerHTML = "<p>暂无数据</p>";
    return;
  }

  container.innerHTML = "<p>已加载 " + data.length + " 位 Pro 用户</p>";
}

// 初始化 Pro 用户管理
function initProManagement() {
  loadProUsersList(1);
}

// 立即备份
async function handleBackupNow() {
  try {
    const response = await fetch("/api/admin/backup/now", { method: "POST" });
    const result = await response.json();

    if (result.success) {
      alert("备份任务已启动");
    } else {
      alert(result.error || "备份失败");
    }
  } catch (error) {
    console.error("备份失败:", error);
    alert("备份失败");
  }
}


// ==================== 侧边栏权限排序与折叠功能 ====================

/**
 * 渲染侧边栏 Tab，按权限排序：有权限的在上，无权限的折叠在下
 */
function renderSidebarTabs() {
  // 获取配置和权限
  const tabsConfig = window.sidebarTabsConfig || [];
  const perms = Array.isArray(window.adminPermissions) ? window.adminPermissions : [];
  const isSuper = window.adminRole === 'super';
  
  // 权限映射表（与后端保持一致）
  const tabPermMap = {
    'overview': null, // 概览默认所有人可见
    'dau-details': 'dau-details',
    'online-users': 'online-users',
    'cohorts': 'cohorts',
    'rootdata': 'rootdata',
    'binance-square': 'binance-square',
    'notes': 'notes',
    'log-search': 'log-search:read',
    'device-monitor': 'device-status:read',
    'version-stats': 'version-stats',
    'url-stats': 'url-stats',
    'security-violations': 'security-violations',
    'messages': 'messages',
    'data-export': 'export:users',
    'reviews-management': 'reviews-management',
    'pro-management': 'pro-management',
    'vip-management': 'vip-management',
    'perf-monitor': 'perf-monitor',
    'backup': 'backup:operate',
    'server-command': 'server:execute',
    'daily-report-email': 'daily-report:send',
    'admin-audit-logs': 'audit-logs:read',
    'nacos-messages': 'nacos-messages',
    'nacos-campaigns': 'nacos_config',
    'feature-flags': 'feature_flags_config',
    'redis-management': 'redis-management',
    'llm-test': 'llm-test',
    'admin-users': 'admin-users',
  };
  
  // 检查是否有权限
  function hasPermission(tabId) {
    if (isSuper || perms.includes('*')) return true;
    const needPerm = tabPermMap[tabId];
    if (!needPerm) return true; // 不需要权限的默认允许
    return perms.includes(needPerm);
  }
  
  // 分离有权限和无权限的 Tab
  const permittedTabs = [];
  const noPermTabs = [];
  
  tabsConfig.forEach(tab => {
    if (hasPermission(tab.id)) {
      permittedTabs.push(tab);
    } else {
      noPermTabs.push(tab);
    }
  });
  
  // 渲染有权限的区域
  const permittedSection = document.getElementById('nav-permitted-section');
  if (permittedSection) {
    // 保留第一个 Tab 的 active 状态
    permittedSection.innerHTML = permittedTabs.map((tab, index) => {
      const isActive = index === 0 ? 'active' : '';
      return createTabButton(tab, isActive, false);
    }).join('');
  }
  
  // 渲染无权限的区域
  const noPermSection = document.getElementById('nav-no-perm-section');
  const noPermContent = document.getElementById('nav-no-perm-content');
  const noPermCount = document.getElementById('nav-no-perm-count');
  
  if (noPermTabs.length > 0 && noPermSection && noPermContent) {
    // 更新数量
    if (noPermCount) {
      noPermCount.textContent = `(${noPermTabs.length})`;
    }
    
    // 渲染无权限 Tab（添加 no-perm 类）
    noPermContent.innerHTML = noPermTabs.map(tab => {
      return createTabButton(tab, '', true);
    }).join('');
    
    // 显示折叠区域
    noPermSection.style.display = 'block';
    
    // 绑定折叠/展开事件
    bindCollapseToggle();
  } else if (noPermSection) {
    // 没有无权限的 Tab，隐藏整个区域
    noPermSection.style.display = 'none';
  }
  
  console.log(`[Sidebar] 有权限: ${permittedTabs.length}, 无权限: ${noPermTabs.length}`);
}

/**
 * 创建 Tab 按钮 HTML
 */
function createTabButton(tab, activeClass, isNoPerm) {
  const noPermClass = isNoPerm ? 'no-perm' : '';
  const clickHandler = isNoPerm ? 'onclick="showNoPermAlert(event)"' : '';
  
  return `
    <button class="tab-btn ${activeClass} ${noPermClass}" data-tab="${tab.id}" ${clickHandler}>
      <svg class="nav-icon-svg"><use href="${tab.icon}"/></svg>
      <span class="nav-text">${escapeHtml(tab.text)}</span>
      ${isNoPerm ? '<span class="no-perm-badge">无权限</span>' : ''}
    </button>
  `;
}

/**
 * 绑定折叠/展开事件
 */
function bindCollapseToggle() {
  const toggleBtn = document.getElementById('nav-collapse-toggle');
  const content = document.getElementById('nav-no-perm-content');
  
  if (!toggleBtn || !content) return;
  
  // 从 localStorage 读取折叠状态
  const isCollapsed = localStorage.getItem('sidebar_no_perm_collapsed') !== 'false';
  
  // 应用初始状态
  if (isCollapsed) {
    content.classList.add('collapsed');
    toggleBtn.classList.add('collapsed');
  }
  
  toggleBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const isNowCollapsed = content.classList.toggle('collapsed');
    toggleBtn.classList.toggle('collapsed', isNowCollapsed);
    
    // 保存状态
    localStorage.setItem('sidebar_no_perm_collapsed', isNowCollapsed);
  });
}

/**
 * 显示无权限提示
 */
function showNoPermAlert(event) {
  event.preventDefault();
  event.stopPropagation();
  
  // 获取 Tab 名称
  const tabBtn = event.currentTarget;
  const tabText = tabBtn.querySelector('.nav-text')?.textContent || '该功能';
  
  alert(`您没有「${tabText}」的访问权限\n\n如需访问，请联系超级管理员申请权限。`);
}

/**
 * HTML 转义（辅助函数）
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 绑定 LLM 测试工具事件
 */
function bindLlmTestEvents() {
  // 温度滑块
  const tempSlider = document.getElementById('llm-temperature');
  const tempValue = document.getElementById('llm-temp-value');
  const tempHint = document.getElementById('llm-temp-hint');
  
  if (tempSlider) {
    tempSlider.addEventListener('input', function() {
      const val = this.value;
      if (tempValue) tempValue.textContent = val;
      if (tempHint) {
        const v = parseFloat(val);
        if (v <= 0.3) tempHint.textContent = `${v} - 分析/提取（稳定）`;
        else if (v <= 0.7) tempHint.textContent = `${v} - 通用问答（平衡）`;
        else tempHint.textContent = `${v} - 创意写作（随机）`;
      }
    });
  }
  
  // 输出格式切换
  const formatRadios = document.querySelectorAll('input[name="llm-output-format"]');
  formatRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      const schemaSection = document.getElementById('llm-schema-section');
      if (schemaSection) {
        schemaSection.style.display = this.value === 'json' ? 'block' : 'none';
      }
    });
  });
  
  // 运行测试按钮
  const testBtn = document.getElementById('llm-test-btn');
  if (testBtn) {
    testBtn.addEventListener('click', runLlmTest);
  }
  
  // 回车提交（在提示词输入框中）
  const promptInput = document.getElementById('llm-prompt');
  if (promptInput) {
    promptInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        runLlmTest();
      }
    });
  }
  
  // 历史记录点击事件委托
  const historyList = document.getElementById('llm-history-list');
  if (historyList) {
    historyList.addEventListener('click', function(e) {
      const item = e.target.closest('.history-item');
      if (item) {
        const index = parseInt(item.dataset.index);
        if (!isNaN(index)) {
          loadLlmHistory(index);
        }
      }
    });
  }
  
  // 初始化渲染历史记录
  renderLlmHistory();
}

/**
 * 运行 LLM 测试
 */
// 前端校验 JSON Schema
function validateJsonSchema(schema, path = '') {
  const errors = [];
  
  if (!schema || typeof schema !== 'object') {
    errors.push(`${path}: Schema 必须是对象`);
    return errors;
  }
  
  if (!schema.type) {
    errors.push(`${path}: 缺少 type 字段`);
  }
  
  if (schema.type === 'object') {
    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      errors.push(`${path}: object 类型必须有 properties`);
    } else {
      for (const [key, value] of Object.entries(schema.properties)) {
        const propPath = path ? `${path}.${key}` : key;
        errors.push(...validateJsonSchema(value, propPath));
      }
    }
    
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!schema.properties[field]) {
          errors.push(`${path}: required 字段 "${field}" 不在 properties 中`);
        }
      }
    }
  }
  
  if (schema.type === 'array') {
    if (!schema.items) {
      errors.push(`${path}: array 类型必须有 items`);
    } else {
      errors.push(...validateJsonSchema(schema.items, `${path}.items`));
    }
  }
  
  return errors;
}

async function runLlmTest() {
  const prompt = document.getElementById('llm-prompt')?.value.trim();
  const systemPrompt = document.getElementById('llm-system-prompt')?.value.trim();
  const model = document.getElementById('llm-model')?.value;
  const temperature = parseFloat(document.getElementById('llm-temperature')?.value || 0.7);
  const outputFormatRadio = document.querySelector('input[name="llm-output-format"]:checked');
  const outputFormat = outputFormatRadio ? outputFormatRadio.value : 'text';
  
  if (!prompt) {
    alert('请输入提示词');
    return;
  }

  let jsonSchema = null;
  if (outputFormat === 'json') {
    const schemaText = document.getElementById('llm-json-schema')?.value.trim();
    if (!schemaText) {
      alert('请输入 JSON Schema');
      return;
    }
    try {
      jsonSchema = JSON.parse(schemaText);
    } catch (e) {
      alert('JSON Schema 格式错误: ' + e.message);
      return;
    }
    
    // 前端校验
    const validationErrors = validateJsonSchema(jsonSchema);
    if (validationErrors.length > 0) {
      alert('Schema 校验失败:\n' + validationErrors.join('\n'));
      return;
    }
    
    // 计算 Schema 复杂度
    function countFields(obj, count = 0) {
      if (typeof obj !== 'object' || obj === null) return count;
      if (obj.properties) {
        count += Object.keys(obj.properties).length;
        for (const prop of Object.values(obj.properties)) {
          count = countFields(prop, count);
        }
      }
      if (obj.items) {
        count = countFields(obj.items, count);
      }
      return count;
    }
    
    const fieldCount = countFields(jsonSchema);
    const requiredCount = jsonSchema.required?.length || 0;
    
    if (fieldCount > 20 || requiredCount > 10) {
      console.warn(`Schema 较复杂: ${fieldCount} 个字段, ${requiredCount} 个 required。部分模型可能无法完整输出。`);
    }
  }

  // 显示加载
  const loadingEl = document.getElementById('llm-loading');
  const resultPanelEl = document.getElementById('llm-result-panel');
  const testBtn = document.getElementById('llm-test-btn');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (resultPanelEl) resultPanelEl.style.display = 'none';
  if (testBtn) testBtn.disabled = true;

  // 生成 requestId 用于排查
  const requestId = 'llm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  console.log('[LLM Test] RequestId:', requestId);

  // 显示 requestId 在界面上
  const requestIdEl = document.getElementById('llm-meta-request-id');
  if (requestIdEl) {
    requestIdEl.textContent = requestId;
    requestIdEl.style.display = 'inline';
  }

  try {
    const response = await fetch('/api/admin/llm-test', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        prompt,
        model,
        temperature,
        outputFormat,
        jsonSchema,
        systemPrompt: systemPrompt || undefined,
      }),
    });

    const result = await response.json();

    // 隐藏加载
    if (loadingEl) loadingEl.style.display = 'none';
    if (testBtn) testBtn.disabled = false;

    // 显示结果
    const resultContent = document.getElementById('llm-result-content');
    const resultBadge = document.getElementById('llm-result-badge');
    
    if (resultPanelEl) {
      resultPanelEl.style.display = 'block';
      resultPanelEl.classList.remove('error');
    }

    if (result.success) {
      if (resultBadge) {
        resultBadge.className = 'badge success';
        resultBadge.textContent = '成功';
      }
      if (resultContent) {
        resultContent.className = 'result-code success';
        resultContent.textContent = typeof result.data === 'object' 
          ? JSON.stringify(result.data, null, 2)
          : result.data;
      }
    } else {
      if (resultPanelEl) resultPanelEl.classList.add('error');
      if (resultBadge) {
        resultBadge.className = 'badge error';
        resultBadge.textContent = '失败';
      }
      if (resultContent) {
        resultContent.className = 'result-code error';
        resultContent.textContent = result.error?.message || result.error || '未知错误';
      }
    }

    // 更新元信息
    const metaModel = document.getElementById('llm-meta-model');
    const metaTemp = document.getElementById('llm-meta-temp');
    const metaDuration = document.getElementById('llm-meta-duration');
    const metaRequestId = document.getElementById('llm-meta-request-id');
    
    if (result.meta) {
      if (metaModel) metaModel.textContent = result.meta.model;
      if (metaTemp) metaTemp.textContent = 'T=' + result.meta.temperature;
      if (metaDuration) metaDuration.textContent = result.meta.duration;
      if (metaRequestId && result.meta.requestId) {
        metaRequestId.textContent = result.meta.requestId;
        metaRequestId.style.display = 'inline';
      }
    }
    
    // 保存到历史记录（无论成功失败都保存配置）
    const jsonSchemaText = document.getElementById('llm-json-schema')?.value.trim();
    addToLlmHistory({
      prompt,
      systemPrompt: systemPrompt || '',
      model,
      temperature,
      outputFormat,
      jsonSchema: jsonSchemaText || null
    });

  } catch (error) {
    console.error('[LLM Test] Error:', error);
    if (loadingEl) loadingEl.style.display = 'none';
    if (testBtn) testBtn.disabled = false;
    
    if (resultPanelEl) {
      resultPanelEl.style.display = 'block';
      resultPanelEl.classList.add('error');
    }
    
    const resultBadge = document.getElementById('llm-result-badge');
    const resultContent = document.getElementById('llm-result-content');
    
    if (resultBadge) {
      resultBadge.className = 'badge error';
      resultBadge.textContent = '错误';
    }
    if (resultContent) {
      resultContent.className = 'result-code error';
      resultContent.textContent = '请求失败: ' + error.message;
    }
  }
}

/**
 * 重置 LLM 测试表单
 */
function resetLlmTest() {
  const prompt = document.getElementById('llm-prompt');
  const systemPrompt = document.getElementById('llm-system-prompt');
  const model = document.getElementById('llm-model');
  const temperature = document.getElementById('llm-temperature');
  const tempValue = document.getElementById('llm-temp-value');
  const tempHint = document.getElementById('llm-temp-hint');
  const textRadio = document.querySelector('input[name="llm-output-format"][value="text"]');
  const schemaSection = document.getElementById('llm-schema-section');
  const jsonSchema = document.getElementById('llm-json-schema');
  const resultPanel = document.getElementById('llm-result-panel');
  const metaRequestId = document.getElementById('llm-meta-request-id');
  
  if (prompt) prompt.value = '';
  if (systemPrompt) systemPrompt.value = '';
  if (model) model.selectedIndex = 0;
  if (temperature) temperature.value = 0.7;
  if (tempValue) tempValue.textContent = '0.7';
  if (tempHint) tempHint.textContent = '0.7 - 对话';
  if (textRadio) textRadio.checked = true;
  if (schemaSection) schemaSection.style.display = 'none';
  if (jsonSchema) jsonSchema.value = '';
  if (metaRequestId) metaRequestId.style.display = 'none';
  if (resultPanel) resultPanel.style.display = 'none';
}

/**
 * 切换 Schema 文档折叠
 */
function toggleSchemaDocs() {
  const content = document.getElementById('schema-docs-content');
  const toggle = document.getElementById('schema-docs-toggle');
  if (content && toggle) {
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? '▲' : '▼';
  }
}

// 确保函数在全局作用域可用（兼容旧版浏览器）
window.runLlmTest = runLlmTest;
window.resetLlmTest = resetLlmTest;
window.toggleSchemaDocs = toggleSchemaDocs;
window.bindLlmTestEvents = bindLlmTestEvents;

// ========== LLM 测试历史记录功能 ==========

const LLM_HISTORY_KEY = 'llm_test_history';
const MAX_LLM_HISTORY = 6;

/**
 * 获取 LLM 测试历史记录
 */
function getLlmHistory() {
  try {
    const data = localStorage.getItem(LLM_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('[LLM History] Get failed:', e);
    return [];
  }
}

/**
 * 保存 LLM 测试历史记录
 */
function saveLlmHistory(history) {
  try {
    localStorage.setItem(LLM_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_LLM_HISTORY)));
  } catch (e) {
    console.error('[LLM History] Save failed:', e);
  }
}

/**
 * 添加记录到历史
 */
function addToLlmHistory(record) {
  let history = getLlmHistory();
  
  // 检查是否和最近一条完全相同
  if (history.length > 0) {
    const last = history[0];
    const isSame = last.prompt === record.prompt &&
                   last.model === record.model &&
                   last.systemPrompt === record.systemPrompt &&
                   last.outputFormat === record.outputFormat;
    if (isSame) return; // 相同则不添加
  }
  
  // 添加到开头
  history.unshift({
    ...record,
    timestamp: Date.now()
  });
  
  saveLlmHistory(history);
  renderLlmHistory();
}

/**
 * 渲染历史记录列表
 */
function renderLlmHistory() {
  const container = document.getElementById('llm-history-list');
  if (!container) return;
  
  const history = getLlmHistory();
  
  if (history.length === 0) {
    container.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }
  
  container.innerHTML = history.map((item, index) => {
    const time = new Date(item.timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const promptPreview = item.prompt.substring(0, 30) + (item.prompt.length > 30 ? '...' : '');
    return `
      <div class="history-item" data-index="${index}" title="点击填充配置">
        <div class="history-meta">
          <span class="history-model">${escapeHtml(item.model)}</span>
          <span class="history-time">${time}</span>
        </div>
        <div class="history-prompt">${escapeHtml(promptPreview)}</div>
      </div>
    `;
  }).join('');
}

/**
 * 加载历史记录到表单
 */
function loadLlmHistory(index) {
  const history = getLlmHistory();
  if (!history[index]) return;
  
  const item = history[index];
  
  // 填充表单
  const promptEl = document.getElementById('llm-prompt');
  const systemPromptEl = document.getElementById('llm-system-prompt');
  const modelEl = document.getElementById('llm-model');
  const temperatureEl = document.getElementById('llm-temperature');
  const tempValueEl = document.getElementById('llm-temp-value');
  const tempHintEl = document.getElementById('llm-temp-hint');
  const outputFormat = item.outputFormat || 'text';
  
  if (promptEl) promptEl.value = item.prompt || '';
  if (systemPromptEl) systemPromptEl.value = item.systemPrompt || '';
  if (modelEl) modelEl.value = item.model || 'gemini-3.1-flash-lite-preview';
  if (temperatureEl) {
    temperatureEl.value = item.temperature || 0.7;
    if (tempValueEl) tempValueEl.textContent = item.temperature || 0.7;
    if (tempHintEl) {
      const temp = parseFloat(item.temperature || 0.7);
      if (temp <= 0.3) tempHintEl.textContent = temp + ' - 精确';
      else if (temp <= 0.7) tempHintEl.textContent = temp + ' - 平衡';
      else tempHintEl.textContent = temp + ' - 创意';
    }
  }
  
  // 设置输出格式
  const formatRadio = document.querySelector(`input[name="llm-output-format"][value="${outputFormat}"]`);
  if (formatRadio) formatRadio.checked = true;
  
  // 显示/隐藏 Schema 区域
  const schemaSection = document.getElementById('llm-schema-section');
  if (schemaSection) {
    schemaSection.style.display = outputFormat === 'json' ? 'block' : 'none';
  }
  
  // 填充 JSON Schema
  const jsonSchemaEl = document.getElementById('llm-json-schema');
  if (jsonSchemaEl && item.jsonSchema) {
    jsonSchemaEl.value = typeof item.jsonSchema === 'string' 
      ? item.jsonSchema 
      : JSON.stringify(item.jsonSchema, null, 2);
  }
  
  // 滚动到顶部
  const container = document.getElementById('llm-test-container');
  if (container) container.scrollIntoView({ behavior: 'smooth' });
}

/**
 * 清空历史记录
 */
function clearLlmHistory() {
  if (!confirm('确定要清空所有历史记录吗？')) return;
  localStorage.removeItem(LLM_HISTORY_KEY);
  renderLlmHistory();
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 导出到全局
window.getLlmHistory = getLlmHistory;
window.saveLlmHistory = saveLlmHistory;
window.loadLlmHistory = loadLlmHistory;
window.renderLlmHistory = renderLlmHistory;
window.clearLlmHistory = clearLlmHistory;
window.escapeHtml = escapeHtml;

// ========== 最近访问 Tab 功能 ==========

const RECENT_TABS_KEY = 'xhunt_recent_tabs';
const MAX_RECENT_TABS = 4;

// Tab ID 到名称和图标的映射
const TAB_META_MAP = {
  'overview': { name: '数据概览', icon: 'M3 3v18h18', color: '#3b82f6' },
  'dau-details': { name: '日活详情', icon: 'M3 3v18h18 M7 16v-6l4 6V8l4 6V8l4 6', color: '#10b981' },
  'online-users': { name: '在线用户', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z', color: '#8b5cf6' },
  'cohorts': { name: '用户留存', icon: 'M3 3v18h18 M7 12l4-4 4 4 4-4', color: '#f59e0b' },
  'rootdata': { name: 'RootData', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', color: '#ec4899' },
  'notes': { name: '每日笔记', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', color: '#06b6d4' },
  'log-search': { name: '日志搜索', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0 1 14 0z', color: '#64748b' },
  'device-monitor': { name: '设备监控', icon: 'M9 17H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V7h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z', color: '#84cc16' },
  'version-stats': { name: '版本统计', icon: 'M12 2L2 7l10 5 10-5-10-5z', color: '#6366f1' },
  'url-stats': { name: 'URL 统计', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', color: '#14b8a6' },
  'security-violations': { name: '安全违规', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', color: '#ef4444' },
  'messages': { name: '私信管理', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', color: '#3b82f6' },
  'data-export': { name: '数据导出', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5M12 15V3', color: '#8b5cf6' },
  'reviews-management': { name: '点评管理', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', color: '#f59e0b' },
  'pro-management': { name: 'Pro 管理', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z', color: '#10b981' },
  'perf-monitor': { name: '性能监控', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', color: '#ec4899' },
  'backup': { name: '备份管理', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12', color: '#06b6d4' },
  'server-command': { name: '服务器命令', icon: 'M4 17l6-6-6-6M12 19h8', color: '#f97316' },
  'daily-report-email': { name: '日报邮件', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: '#6366f1' },
  'admin-audit-logs': { name: '操作记录', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0 1 18 0z', color: '#64748b' },
  'nacos-messages': { name: 'Nacos 消息', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', color: '#3b82f6' },
  'nacos-campaigns': { name: 'Nacos 活动', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', color: '#10b981' },
  'feature-flags': { name: '功能开关', icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3', color: '#f59e0b' },
  'redis-management': { name: 'Redis', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4', color: '#ef4444' },
  'llm-test': { name: 'LLM 测试', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: '#8b5cf6' },
};

/**
 * 获取最近访问的 tabs
 */
function getRecentTabs() {
  try {
    const data = localStorage.getItem(RECENT_TABS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 保存最近访问的 tabs
 */
function saveRecentTabs(tabs) {
  try {
    localStorage.setItem(RECENT_TABS_KEY, JSON.stringify(tabs.slice(0, MAX_RECENT_TABS)));
  } catch (e) {
    console.error('[RecentTabs] Save failed:', e);
  }
}

/**
 * 添加 tab 到最近访问
 */
function addToRecentTabs(tabId) {
  const meta = TAB_META_MAP[tabId];
  if (!meta) return; // 未知的 tab 不记录

  let recent = getRecentTabs();
  
  // 移除已存在的相同 tab
  recent = recent.filter(t => t.id !== tabId);
  
  // 添加到开头
  recent.unshift({
    id: tabId,
    name: meta.name,
    icon: meta.icon,
    color: meta.color,
    timestamp: Date.now()
  });
  
  // 限制数量
  if (recent.length > MAX_RECENT_TABS) {
    recent = recent.slice(0, MAX_RECENT_TABS);
  }
  
  saveRecentTabs(recent);
  renderRecentTabs();
}

/**
 * 从最近访问中移除
 */
function removeRecentTab(tabId) {
  let recent = getRecentTabs();
  recent = recent.filter(t => t.id !== tabId);
  saveRecentTabs(recent);
  renderRecentTabs();
}

/**
 * 渲染最近访问 tab 栏
 */
function renderRecentTabs() {
  const container = document.getElementById('recentTabsList');
  const bar = document.getElementById('recentTabsBar');
  if (!container || !bar) return;

  const recent = getRecentTabs();
  const currentTab = sessionStorage.getItem('activeTab') || 'overview';

  if (recent.length === 0) {
    container.innerHTML = '<span class="recent-tabs-empty">点击左侧菜单开始使用</span>';
    bar.classList.remove('visible');
    return;
  }

  bar.classList.add('visible');
  
  container.innerHTML = recent.map(tab => {
    const isActive = tab.id === currentTab;
    return `
      <div class="recent-tab-item ${isActive ? 'active' : ''}" data-tab-id="${tab.id}">
        <svg class="recent-tab-icon" viewBox="0 0 24 24" fill="none" stroke="${isActive ? '#fff' : tab.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="${tab.icon}"/>
        </svg>
        <span class="recent-tab-name">${tab.name}</span>
        <span class="recent-tab-close" data-close-tab="${tab.id}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </span>
      </div>
    `;
  }).join('');
}

/**
 * 切换到最近访问的 tab
 */
function switchToRecentTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (!btn) {
    console.warn('[RecentTabs] Tab button not found:', tabId);
    return;
  }
  
  // 模拟完整的 tab 切换流程
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  
  // 权限检查
  const perms = Array.isArray(window.adminPermissions) ? window.adminPermissions : [];
  const tabPermMap = {
    "dau-details": "dau-details", "online-users": "online-users", "cohorts": "cohorts",
    "rootdata": "rootdata", "notes": "notes", "log-search": "log-search:read",
    "device-monitor": "device-status:read", "version-stats": "version-stats",
    "url-stats": "url-stats", "security-violations": "security-violations",
    "messages": "messages", "data-export": "export:users",
    "reviews-management": "reviews-management", "pro-management": "pro-management",
    "perf-monitor": "perf-monitor", "backup": "backup:operate",
    "server-command": "server:execute", "daily-report-email": "daily-report:send",
    "admin-audit-logs": "audit-logs:read", "nacos-messages": "nacos-messages",
    "nacos-campaigns": "nacos_config", "feature-flags": "feature_flags_config",
    "redis-management": "redis-management", "llm-test": "llm-test",
  };
  
  const need = tabPermMap[tabId];
  if (need && !perms.includes("*") && !perms.includes(need)) {
    alert("您没有权限访问此功能");
    return;
  }
  
  // 移除所有 active 状态
  tabBtns.forEach((b) => b.classList.remove("active"));
  tabPanes.forEach((p) => p.classList.remove("active"));
  
  // 添加当前 active 状态
  btn.classList.add("active");
  const targetPane = document.getElementById(tabId);
  if (targetPane) {
    targetPane.classList.add("active");
  }
  
  // 保存当前选中的 tab
  sessionStorage.setItem("activeTab", tabId);
  
  // 触发 Tab 特定的初始化
  handleTabInit(tabId);
  
  // 触发事件
  document.dispatchEvent(new CustomEvent('stats-tab-activated', { 
    detail: { tabId: tabId } 
  }));
  
  // 添加到最近访问（移到前面）
  addToRecentTabs(tabId);
}

/**
 * 初始化最近访问 tab 栏
 */
function initRecentTabs() {
  const container = document.getElementById('recentTabsList');
  if (!container) return;
  
  // 使用事件委托绑定点击事件
  container.addEventListener('click', function(e) {
    const tabItem = e.target.closest('.recent-tab-item');
    if (!tabItem) return;
    
    const tabId = tabItem.getAttribute('data-tab-id');
    if (!tabId) return;
    
    // 检查是否点击了关闭按钮
    const closeBtn = e.target.closest('.recent-tab-close');
    if (closeBtn) {
      e.stopPropagation();
      removeRecentTab(tabId);
      return;
    }
    
    // 切换 tab
    switchToRecentTab(tabId);
  });
  
  // 初始渲染
  renderRecentTabs();
  
  // 监听 tab 切换事件，更新 active 状态
  document.addEventListener('stats-tab-activated', function(e) {
    if (e.detail && e.detail.tabId) {
      renderRecentTabs();
    }
  });
}

// 暴露到全局（供事件委托使用）
window.switchToRecentTab = switchToRecentTab;
window.removeRecentTab = removeRecentTab;
