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
    });
  });

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
}

/**
 * 运行 LLM 测试
 */
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
  }

  // 显示加载
  const loadingEl = document.getElementById('llm-loading');
  const resultPanelEl = document.getElementById('llm-result-panel');
  const testBtn = document.getElementById('llm-test-btn');
  
  if (loadingEl) loadingEl.style.display = 'block';
  if (resultPanelEl) resultPanelEl.style.display = 'none';
  if (testBtn) testBtn.disabled = true;

  try {
    const response = await fetch('/api/admin/llm-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    
    if (result.meta) {
      if (metaModel) metaModel.textContent = result.meta.model;
      if (metaTemp) metaTemp.textContent = 'T=' + result.meta.temperature;
      if (metaDuration) metaDuration.textContent = result.meta.duration;
    }

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
  
  if (prompt) prompt.value = '';
  if (systemPrompt) systemPrompt.value = '';
  if (model) model.selectedIndex = 0;
  if (temperature) temperature.value = 0.7;
  if (tempValue) tempValue.textContent = '0.7';
  if (tempHint) tempHint.textContent = '0.7 - 对话';
  if (textRadio) textRadio.checked = true;
  if (schemaSection) schemaSection.style.display = 'none';
  if (jsonSchema) jsonSchema.value = '';
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
