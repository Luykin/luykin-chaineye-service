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
    "pro-management": "pro-management",
    "perf-monitor": "perf-monitor",
    backup: "backup:operate",
    "server-command": "server:execute",
    "daily-report-email": "daily-report:send",
    "admin-audit-logs": "audit-logs:read",
    "nacos-messages": "nacos-messages",
    "nacos-campaigns": "nacos_config",
    "feature-flags": "feature_flags_config",
  };

  function hasPermissionForTab(tab) {
    const need = tabPermMap[tab];
    if (!need) return true; // 未配置则默认放行
    if (perms.includes("*")) return true;
    return perms.includes(need);
  }

  // 注入简单样式，标记无权限的 Tab 按钮更淡
  (function ensureNoPermStyle() {
    if (document.getElementById("no-perm-style")) return;
    const style = document.createElement("style");
    style.id = "no-perm-style";
    style.textContent = `
      .tab-btn.no-perm { opacity: 0.6; }
    `;
    document.head.appendChild(style);
  })();

  // 预标记无权限的 Tab 按钮
  tabBtns.forEach((btn) => {
    const t = btn.getAttribute("data-tab");
    if (!hasPermissionForTab(t)) {
      btn.classList.add("no-perm");
      btn.title = "权限不足，请联系管理员";
    }
  });

  function renderNoPermissionPane(tabId) {
    const pane = document.getElementById(tabId);
    if (!pane) return;
    pane.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #9ca3af;">
        <div style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 8px;">权限不足</div>
        <div>请联系管理员为你开通访问权限</div>
      </div>
    `;
  }

  function activateTab(tabId) {
    // 移除所有活跃状态
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanes.forEach((p) => p.classList.remove("active"));

    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const targetPane = document.getElementById(tabId);

    if (targetBtn && targetPane) {
      // 添加活跃状态
      targetBtn.classList.add("active");
      targetPane.classList.add("active");

      // 更新 URL hash
      window.location.hash = tabId;

      // 若无权限，渲染统一的权限不足提示
      if (!hasPermissionForTab(tabId)) {
        renderNoPermissionPane(tabId);
      }

      // 当切换到 backup 页时，自动刷新一次状态
      if (tabId === "backup") {
        if (typeof loadBackupStatus === "function") {
          loadBackupStatus();
        }
      }
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      activateTab(targetTab);
    });
  });

  // 页面加载时检查 hash 并激活对应 Tab
  const currentHash = window.location.hash.substring(1);
  if (currentHash) {
    const targetBtn = document.querySelector(
      `.tab-btn[data-tab="${currentHash}"]`
    );
    if (targetBtn) {
      activateTab(currentHash);
    }
  } else {
    // 如果没有 hash，默认激活第一个 Tab
    const firstTab = tabBtns[0]?.getAttribute("data-tab");
    if (firstTab) {
      activateTab(firstTab);
    }
  }
}

// 绑定下载事件
function bindDownloadEvents() {
  // 有灵魂的KOL 下载事件 - 已注释
  // const downloadReviewersBtn = document.getElementById("downloadReviewersBtn");
  // const downloadReceiversBtn = document.getElementById("downloadReceiversBtn");
  // if (downloadReviewersBtn) {
  //   downloadReviewersBtn.addEventListener("click", downloadReviewersData);
  // }
  // if (downloadReceiversBtn) {
  //   downloadReceiversBtn.addEventListener("click", downloadReceiversData);
  // }
  // 特定用户下载事件 - 已注释
  // const downloadSpecificReviewersBtn = document.getElementById(
  //   "downloadSpecificReviewersBtn"
  // );
  // const downloadSpecificReceiversBtn = document.getElementById(
  //   "downloadSpecificReceiversBtn"
  // );
  // if (downloadSpecificReviewersBtn) {
  //   downloadSpecificReviewersBtn.addEventListener(
  //     "click",
  //     downloadSpecificReviewersData
  //   );
  // }
  // if (downloadSpecificReceiversBtn) {
  //   downloadSpecificReceiversBtn.addEventListener(
  //     "click",
  //     downloadSpecificReceiversData
  //   );
  // }
}

// 绑定数据导出事件
function bindExportEvents() {
  console.log("🔧 开始绑定数据导出事件...");

  // 用户Excel导出
  const exportUsersExcelBtn = document.getElementById("export-users-excel");
  if (exportUsersExcelBtn) {
    exportUsersExcelBtn.addEventListener("click", exportUsersExcel);
    console.log("✅ Excel导出按钮事件绑定成功");
  } else {
    console.error("❌ 未找到Excel导出按钮");
  }

  // 活跃用户名JS导出
  const exportActiveUsersJsBtn = document.getElementById(
    "export-active-users-js"
  );
  if (exportActiveUsersJsBtn) {
    exportActiveUsersJsBtn.addEventListener("click", exportActiveUsersJs);
    console.log("✅ 活跃用户名JS导出按钮事件绑定成功");
  } else {
    console.error("❌ 未找到活跃用户名JS导出按钮");
  }
}

// 下载有灵魂的KOL评论者数据 - 已注释
// function downloadReviewersData() {
//   console.log("开始下载评论者数据...");
//   const reviewers = window.statsData?.kolTagAnalytics?.reviewers || [];
//   console.log("评论者数据:", reviewers);
//   const csvContent = generateReviewersCSV(reviewers);
//   downloadCSV(csvContent, "有灵魂的KOL_评论者名单.csv");
// }

// 下载有灵魂的KOL被评论者数据 - 已注释
// function downloadReceiversData() {
//   console.log("开始下载被评论者数据...");
//   const receivers = window.statsData?.kolTagAnalytics?.receivers || [];
//   console.log("被评论者数据:", receivers);
//   const csvContent = generateReceiversCSV(receivers);
//   downloadCSV(csvContent, "有灵魂的KOL_被评论者名单.csv");
// }

// 下载特定用户评论者数据 - 已注释
// function downloadSpecificReviewersData() {
//   console.log("开始下载特定用户评论者数据...");
//   const reviewers = window.statsData?.specificUsersAnalytics?.reviewers || [];
//   console.log("特定用户评论者数据:", reviewers);
//   const csvContent = generateSpecificReviewersCSV(reviewers);
//   downloadCSV(csvContent, "特定用户_评论者名单.csv");
// }

// 下载特定用户被评论者数据 - 已注释
// function downloadSpecificReceiversData() {
//   console.log("开始下载特定用户被评论者数据...");
//   const receivers = window.statsData?.specificUsersAnalytics?.receivers || [];
//   console.log("特定用户被评论者数据:", receivers);
//   const csvContent = generateSpecificReceiversCSV(receivers);
//   downloadCSV(csvContent, "特定用户_被评论者名单.csv");
// }

// 生成有灵魂的KOL评论者CSV内容 - 已注释
// function generateReviewersCSV(data) {
//   console.log("生成评论者CSV，数据长度:", data.length);
//   const headers = [
//     "排名",
//     "用户名",
//     "显示名称",
//     "分类",
//     "KOL排名",
//     "使用次数",
//     "是否KOL",
//   ];
//   const rows = data.map((item, index) => [
//     index + 1,
//     item.username || "未知",
//     item.displayName || item.username || "匿名用户",
//     item.classification || "-",
//     item.kolRank20W ? item.kolRank20W.toLocaleString() : "-",
//     item.tagUsageCount,
//     item.isKOL ? "是" : "否",
//   ]);

//   return generateCSVContent(headers, rows);
// }

// 生成有灵魂的KOL被评论者CSV内容 - 已注释
// function generateReceiversCSV(data) {
//   console.log("生成被评论者CSV，数据长度:", data.length);
//   const headers = ["排名", "用户名", "显示名称", "被评次数"];
//   const rows = data.map((item, index) => [
//     index + 1,
//     item.handle || "未知",
//     item.displayName || item.handle || "未知账号",
//     item.receivedTagCount,
//   ]);

//   return generateCSVContent(headers, rows);
// }

// 生成特定用户评论者CSV内容 - 已注释
// function generateSpecificReviewersCSV(data) {
//   console.log("生成特定用户评论者CSV，数据长度:", data.length);
//   const headers = [
//     "排名",
//     "用户名",
//     "显示名称",
//     "分类",
//     "KOL排名",
//     "评论次数",
//     "是否KOL",
//   ];
//   const rows = data.map((item, index) => [
//     index + 1,
//     item.username || "未知",
//     item.displayName || item.username || "匿名用户",
//     item.classification || "-",
//     item.kolRank20W ? item.kolRank20W.toLocaleString() : "-",
//     item.reviewCount,
//     item.isKOL ? "是" : "否",
//   ]);

//   return generateCSVContent(headers, rows);
// }

// 生成特定用户被评论者CSV内容 - 已注释
// function generateSpecificReceiversCSV(data) {
//   console.log("生成特定用户被评论者CSV，数据长度:", data.length);
//   const headers = ["排名", "用户名", "显示名称", "被评论次数"];
//   const rows = data.map((item, index) => [
//     index + 1,
//     item.handle || "未知",
//     item.displayName || item.handle || "未知账号",
//     item.reviewCount,
//   ]);

//   return generateCSVContent(headers, rows);
// }

// 生成CSV内容的通用函数
function generateCSVContent(headers, rows) {
  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  console.log("CSV生成完成，长度:", csvContent.length);
  return csvContent;
}

// 下载CSV文件
function downloadCSV(csvContent, filename) {
  console.log("开始下载CSV文件:", filename);
  console.log("CSV内容长度:", csvContent.length);

  try {
    // 添加BOM以支持中文
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    console.log("Blob创建成功，大小:", blob.size);

    // 检查浏览器支持
    if (typeof window.navigator.msSaveBlob !== "undefined") {
      // IE浏览器
      console.log("使用IE下载方式");
      window.navigator.msSaveBlob(blob, filename);
    } else {
      // 现代浏览器
      console.log("使用现代浏览器下载方式");
      const link = document.createElement("a");

      if (typeof link.download !== "undefined") {
        const url = URL.createObjectURL(blob);
        console.log("创建下载URL:", url);

        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = "hidden";
        link.style.position = "absolute";
        link.style.left = "-9999px";

        document.body.appendChild(link);
        console.log("触发点击下载");
        link.click();

        // 延迟清理
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log("清理完成");
        }, 100);
      } else {
        console.error("浏览器不支持下载功能");
        alert("您的浏览器不支持文件下载功能，请使用现代浏览器");
      }
    }
  } catch (error) {
    console.error("下载过程中出现错误:", error);
    alert("下载失败: " + error.message);
  }
}

// 已删除 exportDAUFiles 函数 - 不再需要查看文件列表功能

// 导出用户Excel文件
function exportUsersExcel() {
  console.log("开始导出用户Excel文件...");

  // 显示加载状态
  showExportStatus("正在生成用户Excel文件...");

  // 禁用按钮防止重复点击
  const exportBtn = document.getElementById("export-users-excel");
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span class="btn-icon">⏳</span>正在生成...';
  }

  try {
    // 创建下载链接
    const downloadUrl = "/api/xhunt/stats/export/users/excel";
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `XHunt用户数据_${
      new Date().toISOString().split("T")[0]
    }.xlsx`;
    link.style.display = "none";

    // 添加到页面并触发下载
    document.body.appendChild(link);
    link.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(link);
      hideExportStatus();

      // 恢复按钮状态
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '<span class="btn-icon">📊</span>导出用户Excel';
      }
    }, 2000);

    console.log("用户Excel导出请求已发送");
  } catch (error) {
    console.error("导出用户Excel失败:", error);
    alert("导出失败: " + error.message);

    // 恢复按钮状态
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = '<span class="btn-icon">📊</span>导出用户Excel';
    }

    hideExportStatus();
  }
}

// 导出活跃用户名JS文件
async function exportActiveUsersJs() {
  console.log("开始导出活跃用户名JS文件...");

  // 显示加载状态
  showExportStatus("正在生成活跃用户名JS文件...");

  // 禁用按钮防止重复点击
  const exportBtn = document.getElementById("export-active-users-js");
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span class="btn-icon">⏳</span>正在生成...';
  }

  try {
    // 使用 fetch API 下载文件（这样可以确保认证信息被正确发送）
    const downloadUrl = "/api/xhunt/stats/export/active-users/js";
    const response = await fetch(downloadUrl, {
      method: "GET",
      credentials: "include", // 包含 cookies
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 获取文件内容
    const blob = await response.blob();

    // 创建下载链接
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `allActiveUserName_${
      new Date().toISOString().split("T")[0]
    }.js`;
    link.style.display = "none";

    // 添加到页面并触发下载
    document.body.appendChild(link);
    link.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url); // 释放 URL 对象
      hideExportStatus();

      // 恢复按钮状态
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML =
          '<span class="btn-icon">📝</span>导出活跃用户名JS';
      }
    }, 1000);

    console.log("活跃用户名JS导出完成");
  } catch (error) {
    console.error("导出活跃用户名JS失败:", error);
    alert("导出失败: " + error.message);

    // 恢复按钮状态
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = '<span class="btn-icon">📝</span>导出活跃用户名JS';
    }

    hideExportStatus();
  }
}

// 显示导出状态
function showExportStatus(message) {
  const statusDiv = document.getElementById("export-status");
  if (statusDiv) {
    const statusText = statusDiv.querySelector(".status-text");
    if (statusText) {
      statusText.textContent = message;
    }
    statusDiv.style.display = "block";
  }
}

// 隐藏导出状态
function hideExportStatus() {
  const statusDiv = document.getElementById("export-status");
  if (statusDiv) {
    statusDiv.style.display = "none";
  }
}

// ============ Rootdata API 配额相关功能 ============

/**
 * 通过代理服务器加载图片URL（解决跨域问题）
 */
function getProxiedImageUrl(imageUrl) {
  if (!imageUrl) return "";
  // 使用服务器的图片代理
  return `/api/proxy?url=${encodeURIComponent(imageUrl)}`;
}

/**
 * 加载 Rootdata API 配额信息
 */
async function loadRootdataQuota() {
  const loadingEl = document.getElementById("rootdata-loading");
  const errorEl = document.getElementById("rootdata-error");

  // 显示加载状态
  if (loadingEl) loadingEl.style.display = "block";
  if (errorEl) errorEl.style.display = "none";

  try {
    const response = await fetch("/api/xhunt/stats/rootdata-quota");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "获取配额失败");
    }

    const data = result.data;

    // 更新显示
    updateRootdataQuotaUI(data);
  } catch (error) {
    console.error("加载 Rootdata 配额失败:", error);

    // 显示错误信息
    if (errorEl) {
      errorEl.style.display = "block";
      const errorMsg = document.getElementById("rootdata-error-message");
      if (errorMsg) {
        errorMsg.textContent = error.message;
      }
    }
  } finally {
    // 隐藏加载状态
    if (loadingEl) loadingEl.style.display = "none";
  }
}

/**
 * 更新 Rootdata 配额 UI
 */
function updateRootdataQuotaUI(data) {
  // 更新文本
  document.getElementById("rootdata-level").textContent =
    data.level.toUpperCase();
  document.getElementById("rootdata-remaining").textContent = formatNumber(
    data.credits
  );
  document.getElementById("rootdata-total").textContent = formatNumber(
    data.totalCredits
  );
  document.getElementById("rootdata-used").textContent = formatNumber(
    data.used
  );
  document.getElementById("rootdata-usage-percent").textContent =
    data.usagePercent + "%";

  // 格式化日期
  const startDate = new Date(data.periodStart);
  const endDate = new Date(data.periodEnd);
  document.getElementById("rootdata-period-start").textContent =
    startDate.toLocaleDateString("zh-CN");
  document.getElementById("rootdata-period-end").textContent =
    endDate.toLocaleDateString("zh-CN");

  // 更新进度条
  const progressBar = document.getElementById("rootdata-progress-bar");
  const progressText = document.getElementById("rootdata-progress-text");

  if (progressBar && progressText) {
    progressBar.style.width = data.usagePercent + "%";
    progressText.textContent = data.usagePercent + "%";

    // 根据使用率改变颜色
    if (data.usagePercent >= 90) {
      progressBar.style.background = "linear-gradient(90deg, #ef4444, #dc2626)"; // 红色
    } else if (data.usagePercent >= 70) {
      progressBar.style.background = "linear-gradient(90deg, #f59e0b, #d97706)"; // 橙色
    } else {
      progressBar.style.background = "linear-gradient(90deg, #10b981, #3b82f6)"; // 绿蓝渐变
    }
  }

  // 更新剩余额度颜色
  const remainingEl = document.getElementById("rootdata-remaining");
  if (remainingEl) {
    if (data.usagePercent >= 90) {
      remainingEl.style.color = "#ef4444"; // 红色
    } else if (data.usagePercent >= 70) {
      remainingEl.style.color = "#f59e0b"; // 橙色
    } else {
      remainingEl.style.color = "#10b981"; // 绿色
    }
  }
}

/**
 * 格式化数字（添加千位分隔符）
 */
function formatNumber(num) {
  if (num === undefined || num === null) return "-";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 绑定 Rootdata 页面事件
 */
function bindRootdataEvents() {
  // 绑定手动爬虫按钮
  const manualCrawlBtn = document.getElementById("rootdata-manual-crawl-btn");
  if (manualCrawlBtn) {
    manualCrawlBtn.addEventListener("click", function () {
      triggerManualCrawl();
    });
  }

  // 绑定配额刷新按钮
  const quotaRefreshBtn = document.getElementById("rootdata-quota-refresh-btn");
  if (quotaRefreshBtn) {
    quotaRefreshBtn.addEventListener("click", function () {
      loadRootdataQuota();
    });
  }

  // 绑定查询按钮
  const queryBtn = document.getElementById("rootdata-query-btn");
  if (queryBtn) {
    queryBtn.addEventListener("click", function () {
      loadRootdataDailyStats();
    });
  }

  // 绑定设置 isInitial 按钮
  const setInitialBtn = document.getElementById("rootdata-set-initial-btn");
  if (setInitialBtn) {
    setInitialBtn.addEventListener("click", function () {
      setDailyProjectsAsInitial();
    });
  }

  // 绑定 Tab 切换按钮
  const tabBtns = document.querySelectorAll(".rootdata-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const tabName = this.getAttribute("data-rootdata-tab");
      switchRootdataTab(tabName);
    });
  });

  // 使用事件委托绑定分页按钮（因为是动态生成的）
  document.addEventListener("click", function (e) {
    if (e.target.classList.contains("rootdata-page-btn")) {
      const page = parseInt(e.target.getAttribute("data-page"));
      if (!isNaN(page) && page > 0) {
        loadRootdataDailyStats(page);
      }
    }
  });

  // 延迟加载配额信息
  setTimeout(() => {
    loadRootdataQuota();
  }, 500);
}

// 当前分页状态
let rootdataCurrentPage = 1;
let rootdataSelectedDate = null;

/**
 * 手动触发爬虫
 */
async function triggerManualCrawl() {
  const urlInput = document.getElementById("rootdata-manual-url");
  const statusDiv = document.getElementById("rootdata-crawl-status");
  const statusText = document.getElementById("rootdata-crawl-status-text");
  const messageDiv = document.getElementById("rootdata-crawl-message");
  const resultDiv = document.getElementById("rootdata-crawl-result");
  const crawlBtn = document.getElementById("rootdata-manual-crawl-btn");

  const url = urlInput.value.trim();

  if (!url) {
    alert("请输入 RootData 项目详情页 URL");
    return;
  }

  // 简单验证 URL 格式
  if (!url.includes("rootdata.com")) {
    alert("请输入有效的 RootData URL");
    return;
  }

  // 显示状态
  statusDiv.style.display = "block";
  resultDiv.style.display = "none";
  statusText.textContent = "爬取中...";
  statusText.style.color = "#3b82f6";
  messageDiv.textContent = `正在爬取: ${url}`;
  crawlBtn.disabled = true;
  crawlBtn.style.opacity = "0.5";
  crawlBtn.style.cursor = "not-allowed";

  try {
    const response = await fetch("/api/rootdata/manual-crawl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      statusText.textContent = "✅ 爬取成功";
      statusText.style.color = "#10b981";

      const { project, asInvestor, asInvestee } = result.data;

      messageDiv.innerHTML = `
        <div style="margin-top: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            ${
              project.logo
                ? `<img src="${getProxiedImageUrl(
                    project.logo
                  )}" style="width: 32px; height: 32px; border-radius: 50%;" />`
                : ""
            }
            <strong style="font-size: 16px;">${project.projectName}</strong>
          </div>
          <div style="color: #6b7280; font-size: 13px; margin-bottom: 5px;">
            <a href="${
              project.projectLink
            }" target="_blank" style="color: #3b82f6;">${
        project.projectLink
      }</a>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px;">
            <div style="background: #eff6ff; padding: 10px; border-radius: 6px;">
              <div style="color: #6b7280; font-size: 12px;">对外投资</div>
              <div style="font-size: 24px; font-weight: 700; color: #3b82f6;">${
                asInvestor.length
              }</div>
              <div style="color: #6b7280; font-size: 12px;">个项目</div>
            </div>
            <div style="background: #f0fdf4; padding: 10px; border-radius: 6px;">
              <div style="color: #6b7280; font-size: 12px;">获得投资</div>
              <div style="font-size: 24px; font-weight: 700; color: #10b981;">${
                asInvestee.length
              }</div>
              <div style="color: #6b7280; font-size: 12px;">个投资者</div>
            </div>
          </div>
        </div>
      `;

      // 显示详细结果
      resultDiv.style.display = "block";

      let investorListHtml = "";
      if (asInvestor.length > 0) {
        investorListHtml = `
          <div style="margin-top: 15px;">
            <div style="font-weight: 600; color: #374151; margin-bottom: 10px;">📤 对外投资 (${
              asInvestor.length
            })</div>
            <div style="max-height: 200px; overflow-y: auto;">
              ${asInvestor
                .map(
                  (r) => `
                <div style="display: flex; align-items: center; gap: 10px; padding: 8px; background: #f9fafb; border-radius: 4px; margin-bottom: 6px;">
                  ${
                    r.project.logo
                      ? `<img src="${getProxiedImageUrl(
                          r.project.logo
                        )}" style="width: 24px; height: 24px; border-radius: 50%;" />`
                      : ""
                  }
                  <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 13px;">${
                      r.project.projectName
                    }</div>
                    ${
                      r.round
                        ? `<div style="color: #6b7280; font-size: 11px;">${
                            r.round
                          }${r.amount ? ` · ${r.amount}` : ""}</div>`
                        : ""
                    }
                  </div>
                  ${
                    r.lead
                      ? '<span style="background: #fbbf24; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">Lead</span>'
                      : ""
                  }
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      let investeeListHtml = "";
      if (asInvestee.length > 0) {
        investeeListHtml = `
          <div style="margin-top: 15px;">
            <div style="font-weight: 600; color: #374151; margin-bottom: 10px;">📥 获得投资 (${
              asInvestee.length
            })</div>
            <div style="max-height: 200px; overflow-y: auto;">
              ${asInvestee
                .map(
                  (r) => `
                <div style="display: flex; align-items: center; gap: 10px; padding: 8px; background: #f9fafb; border-radius: 4px; margin-bottom: 6px;">
                  ${
                    r.investor.logo
                      ? `<img src="${getProxiedImageUrl(
                          r.investor.logo
                        )}" style="width: 24px; height: 24px; border-radius: 50%;" />`
                      : ""
                  }
                  <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 13px;">${
                      r.investor.projectName
                    }</div>
                    ${
                      r.round
                        ? `<div style="color: #6b7280; font-size: 11px;">${
                            r.round
                          }${r.amount ? ` · ${r.amount}` : ""}</div>`
                        : ""
                    }
                  </div>
                  ${
                    r.lead
                      ? '<span style="background: #fbbf24; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">Lead</span>'
                      : ""
                  }
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      resultDiv.innerHTML = `
        <div style="padding: 15px; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 4px;">
          <div style="color: #065f46; font-weight: 600; margin-bottom: 8px;">
            ✅ 爬取完成
          </div>
          <div style="color: #047857; font-size: 13px; margin-bottom: 10px;">
            ${result.message || "数据已成功保存到数据库"}
          </div>
          ${investorListHtml}
          ${investeeListHtml}
        </div>
      `;
    } else {
      throw new Error(result.message || result.error || "爬取失败");
    }
  } catch (error) {
    console.error("爬取失败:", error);
    statusText.textContent = "❌ 爬取失败";
    statusText.style.color = "#ef4444";
    messageDiv.textContent = error.message;

    resultDiv.style.display = "block";
    resultDiv.innerHTML = `
      <div style="padding: 15px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
        <div style="color: #991b1b; font-weight: 600; margin-bottom: 8px;">
          ❌ 爬取失败
        </div>
        <div style="color: #b91c1c; font-size: 13px;">
          ${error.message}
        </div>
      </div>
    `;
  } finally {
    crawlBtn.disabled = false;
    crawlBtn.style.opacity = "1";
    crawlBtn.style.cursor = "pointer";
  }
}

/**
 * 加载 Rootdata 每日统计数据
 */
async function loadRootdataDailyStats(page = 1) {
  const dateInput = document.getElementById("rootdata-date-picker");
  const selectedDate = dateInput.value;

  if (!selectedDate) {
    alert("请选择日期");
    return;
  }

  rootdataSelectedDate = selectedDate;
  rootdataCurrentPage = page;

  // 显示加载状态
  document.getElementById("rootdata-daily-loading").style.display = "block";
  document.getElementById("rootdata-daily-error").style.display = "none";
  document.getElementById("rootdata-daily-summary").style.display = "none";
  document.getElementById("rootdata-daily-tabs").style.display = "none";
  document.getElementById("rootdata-daily-empty").style.display = "none";

  try {
    const response = await fetch(
      `/api/xhunt/stats/rootdata-daily?date=${selectedDate}&page=${page}&limit=50`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to load data");
    }

    const { data } = result;

    // 隐藏加载状态
    document.getElementById("rootdata-daily-loading").style.display = "none";

    // 检查是否有数据
    if (
      data.summary.projectsCount === 0 &&
      data.summary.relationshipsCount === 0
    ) {
      document.getElementById("rootdata-daily-empty").style.display = "block";
      return;
    }

    // 显示统计概览
    document.getElementById("rootdata-daily-summary").style.display = "block";
    document.getElementById("rootdata-new-projects-count").textContent =
      data.summary.projectsCount;
    document.getElementById("rootdata-new-relationships-count").textContent =
      data.summary.relationshipsCount;
    document.getElementById("rootdata-query-date").textContent = selectedDate;

    // 显示 Tab
    document.getElementById("rootdata-daily-tabs").style.display = "block";

    // 渲染项目列表（带分页）
    renderRootdataProjects(data.projects, data.pagination);

    // 渲染投资关系列表（带分页）
    renderRootdataRelationships(data.relationships, data.pagination);
  } catch (error) {
    console.error("加载 Rootdata 每日数据失败:", error);
    document.getElementById("rootdata-daily-loading").style.display = "none";
    document.getElementById("rootdata-daily-error").style.display = "block";
    document.getElementById("rootdata-daily-error-message").textContent =
      error.message;
  }
}

/**
 * 渲染项目列表
 */
function renderRootdataProjects(projects, pagination) {
  const container = document.getElementById("rootdata-projects-table");

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #9ca3af;">
        暂无新增项目
      </div>
    `;
    return;
  }

  let html = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Logo</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">项目名称</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">描述</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">社交链接</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">融资时间</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">抓取状态</th>
          <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">初始项目</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">创建时间</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">链接</th>
        </tr>
      </thead>
      <tbody>
  `;

  projects.forEach((project, index) => {
    const bgColor = index % 2 === 0 ? "#ffffff" : "#f9fafb";
    const createdAt = new Date(project.createdAt).toLocaleString("zh-CN");

    // 社交链接处理
    const socialLinks = project.socialLinks || {};
    const socialLinksHtml = [];
    if (socialLinks.x)
      socialLinksHtml.push(
        `<a href="${socialLinks.x}" target="_blank" style="color: #3b82f6; text-decoration: none; margin-right: 5px;">🐦 X</a>`
      );
    if (socialLinks.discord)
      socialLinksHtml.push(
        `<a href="${socialLinks.discord}" target="_blank" style="color: #5865F2; text-decoration: none; margin-right: 5px;">💬 Discord</a>`
      );
    if (socialLinks.telegram)
      socialLinksHtml.push(
        `<a href="${socialLinks.telegram}" target="_blank" style="color: #0088cc; text-decoration: none; margin-right: 5px;">✈️ Telegram</a>`
      );
    const socialDisplay =
      socialLinksHtml.length > 0 ? socialLinksHtml.join("") : "-";

    // 融资时间
    const fundedAt = project.fundedAt
      ? new Date(project.fundedAt).toLocaleDateString("zh-CN")
      : "-";

    // 抓取状态
    const detailFetchedAt = project.detailFetchedAt
      ? new Date(project.detailFetchedAt).toLocaleString("zh-CN")
      : "-";
    const failures = project.detailFailuresNumber || 0;

    // 判断抓取状态
    // failures = 0: 抓取成功且有投资者数据
    // failures = 99: 抓取成功但无投资者数据（基础信息已抓取）
    // 0 < failures < 99: 抓取失败
    let fetchStatusColor;
    let fetchStatusText;

    if (failures === 0 || failures === 99) {
      fetchStatusColor = "#10b981"; // 绿色
      fetchStatusText = failures === 0 ? "抓取成功" : "抓取成功(无投资者)";
    } else if (failures < 3) {
      fetchStatusColor = "#f59e0b"; // 黄色
      fetchStatusText = `失败: ${failures}次`;
    } else {
      fetchStatusColor = "#ef4444"; // 红色
      fetchStatusText = `失败: ${failures}次`;
    }

    const fetchStatus = `
      <div style="font-size: 12px;">
        <div style="color: ${fetchStatusColor}; font-weight: 600;">${fetchStatusText}</div>
        <div style="color: #6b7280; font-size: 11px;">${detailFetchedAt}</div>
      </div>
    `;

    // isInitial 状态
    const isInitialBadge = project.isInitial
      ? '<span style="display: inline-block; padding: 4px 8px; background: #10b981; color: white; border-radius: 4px; font-size: 11px; font-weight: 600;">是</span>'
      : '<span style="display: inline-block; padding: 4px 8px; background: #6b7280; color: white; border-radius: 4px; font-size: 11px; font-weight: 600;">否</span>';

    html += `
      <tr style="background: ${bgColor}; border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px;">
          ${
            project.logo
              ? `<img src="${getProxiedImageUrl(project.logo)}" alt="${
                  project.projectName
                }" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">`
              : `<div style="width: 40px; height: 40px; border-radius: 50%; background: #e5e7eb; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280;">无</div>`
          }
        </td>
        <td style="padding: 12px; font-weight: 600; color: #111827;">${
          project.projectName
        }</td>
        <td style="padding: 12px; color: #6b7280; font-size: 13px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${
          project.description || "-"
        }">
          ${project.description || "-"}
        </td>
        <td style="padding: 12px; font-size: 12px;">${socialDisplay}</td>
        <td style="padding: 12px; color: #6b7280; font-size: 13px;">${fundedAt}</td>
        <td style="padding: 12px;">${fetchStatus}</td>
        <td style="padding: 12px; text-align: center;">${isInitialBadge}</td>
        <td style="padding: 12px; color: #6b7280; font-size: 13px;">${createdAt}</td>
        <td style="padding: 12px;">
          <a href="${
            project.projectLink
          }" target="_blank" style="color: #3b82f6; text-decoration: none; font-size: 13px;">🔗 查看详情</a>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  // 添加分页控件
  if (pagination && pagination.totalProjectPages > 1) {
    html += renderPagination(
      pagination.currentPage,
      pagination.totalProjectPages,
      "projects"
    );
  }

  container.innerHTML = html;
}

/**
 * 绑定 数据库备份 事件
 */
function bindBackupEvents() {
  const refreshBtn = document.getElementById("btn-backup-refresh");
  const runBtn = document.getElementById("btn-backup-run");
  const backupTabBtn = document.querySelector('.tab-btn[data-tab="backup"]');

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadBackupStatus());
  }
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      await triggerManualBackup();
    });
  }
  if (backupTabBtn) {
    backupTabBtn.addEventListener("click", () => {
      // 切到 tab 时加载一次
      setTimeout(() => loadBackupStatus(), 0);
    });
  }
}

/** 加载备份状态 */
async function loadBackupStatus() {
  // const statusBox = document.getElementById("backup-status");
  const listBox = document.getElementById("backup-list");
  if (!listBox) return;

  // statusBox.style.display = "block";
  // statusBox.innerHTML = '<div class="status-line">⏳ 正在加载备份列表...</div>';
  listBox.innerHTML = "";
  try {
    const res = await fetch("/api/xhunt/stats/backup-status", {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "获取失败");

    const backups = data.data.backups || [];
    const stats = data.data.stats || {};

    // statusBox.style.display = "block";
    // statusBox.innerHTML = `
    //   <div class="status-line">备份目录：${stats.backupDir || '-'} </div>
    //   <div class="status-line">备份数量：${stats.totalBackups || 0} / ${stats.maxBackups || 10}</div>
    //   <div class="status-line">总大小：${stats.totalSizeMB || '0.00'} MB</div>
    // `;

    if (!backups.length) {
      listBox.innerHTML = '<div class="status-line">暂无备份文件</div>';
      return;
    }

    const rows = backups
      .map(
        (b, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${b.name}</td>
          <td>${b.sizeMB} MB</td>
          <td>${b.mtimeStr}</td>
          <td><code style="font-size:12px">${b.path}</code></td>
        </tr>`
      )
      .join("");

    listBox.innerHTML = `
      <table class="simple-table">
        <thead>
          <tr>
            <th>#</th>
            <th>文件名</th>
            <th>大小</th>
            <th>时间</th>
            <th>路径</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    // statusBox.style.display = "block";
    // statusBox.innerHTML = `<div class="status-line" style="color:#dc3545">❌ 加载失败：${err.message}</div>`;
  }
}

/** 手动触发备份 */
async function triggerManualBackup() {
  // const statusBox = document.getElementById("backup-status");
  // if (statusBox) {
  //   statusBox.style.display = "block";
  //   statusBox.innerHTML = '<div class="status-line">🚀 已触发备份任务，请稍后刷新查看...</div>';
  // }
  try {
    const res = await fetch("/api/xhunt/stats/trigger-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok || !data.success)
      throw new Error(data.error || `HTTP ${res.status}`);
    // 稍等几秒再刷新
    setTimeout(() => loadBackupStatus(), 3000);
  } catch (err) {}
}

/**
 * 渲染投资关系列表
 */
function renderRootdataRelationships(relationships, pagination) {
  const container = document.getElementById("rootdata-relationships-table");

  if (!relationships || relationships.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #9ca3af;">
        暂无新增投资关系
      </div>
    `;
    return;
  }

  let html = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">投资方</th>
          <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">→</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">被投项目</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">轮次</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">金额</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">主导</th>
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">创建时间</th>
          <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151; width: 200px;">操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  relationships.forEach((rel, index) => {
    const bgColor = index % 2 === 0 ? "#ffffff" : "#f9fafb";
    const createdAt = new Date(rel.createdAt).toLocaleString("zh-CN");
    const amount = rel.formattedAmount
      ? `$${rel.formattedAmount.toFixed(2)}M`
      : "-";
    const lead = rel.lead ? "✅" : "-";

    html += `
      <tr style="background: ${bgColor}; border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${
              rel.investorProject?.logo
                ? `<img src="${getProxiedImageUrl(
                    rel.investorProject.logo
                  )}" alt="${
                    rel.investorProject.projectName
                  }" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
                : `<div style="width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb;"></div>`
            }
            <div>
              <div style="font-weight: 600; color: #111827;">${
                rel.investorProject?.projectName || "-"
              }</div>
              <a href="${
                rel.investorProject?.projectLink || "#"
              }" target="_blank" style="color: #3b82f6; text-decoration: none; font-size: 11px;">查看</a>
            </div>
          </div>
        </td>
        <td style="padding: 12px; text-align: center; font-size: 20px; color: #9ca3af;">→</td>
        <td style="padding: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${
              rel.fundedProject?.logo
                ? `<img src="${getProxiedImageUrl(
                    rel.fundedProject.logo
                  )}" alt="${
                    rel.fundedProject.projectName
                  }" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
                : `<div style="width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb;"></div>`
            }
            <div>
              <div style="font-weight: 600; color: #111827;">${
                rel.fundedProject?.projectName || "-"
              }</div>
              <a href="${
                rel.fundedProject?.projectLink || "#"
              }" target="_blank" style="color: #3b82f6; text-decoration: none; font-size: 11px;">查看</a>
            </div>
          </div>
        </td>
        <td style="padding: 12px; color: #6b7280;">${rel.round || "-"}</td>
        <td style="padding: 12px; color: #10b981; font-weight: 600;">${amount}</td>
        <td style="padding: 12px; text-align: center;">${lead}</td>
        <td style="padding: 12px; color: #6b7280; font-size: 13px;">${createdAt}</td>
        <td style="padding: 12px; text-align: center;">
          <button
            class="delete-relationship-btn"
            data-relationship-id="${rel.id}"
            style="padding: 4px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 5px;"
            title="删除本条记录"
          >
            🗑️ 删除
          </button>
          <button
            class="delete-funded-project-btn"
            data-funded-project-id="${rel.fundedProjectId}"
            data-funded-project-name="${rel.fundedProject?.projectName || ""}"
            style="padding: 4px 12px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;"
            title="删除该被投项目的所有投资关系"
          >
            🗑️ 删全部
          </button>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  // 添加分页控件
  if (pagination && pagination.totalRelationshipPages > 1) {
    html += renderPagination(
      pagination.currentPage,
      pagination.totalRelationshipPages,
      "relationships"
    );
  }

  container.innerHTML = html;

  // 绑定删除按钮事件
  bindDeleteRelationshipEvents();
}

/**
 * 绑定删除投资关系按钮事件
 */
function bindDeleteRelationshipEvents() {
  // 删除单条记录
  document.querySelectorAll(".delete-relationship-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const relationshipId = this.getAttribute("data-relationship-id");
      if (!confirm("确定要删除这条投资关系记录吗？")) {
        return;
      }

      try {
        const response = await fetch(
          `/api/rootdata/relationship/${relationshipId}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        const result = await response.json();
        if (response.ok) {
          alert("✅ 删除成功");
          // 重新加载当前日期的数据（保持当前页码）
          loadRootdataDailyStats(rootdataCurrentPage);
        } else {
          alert(`❌ 删除失败: ${result.message || "未知错误"}`);
        }
      } catch (error) {
        console.error("删除失败:", error);
        alert("❌ 删除失败: " + error.message);
      }
    });
  });

  // 删除被投项目的所有记录（仅删除当前日期范围内的）
  document.querySelectorAll(".delete-funded-project-btn").forEach((btn) => {
    btn.addEventListener("click", async function () {
      const fundedProjectId = this.getAttribute("data-funded-project-id");
      const projectName = this.getAttribute("data-funded-project-name");

      // 获取当前查看的日期
      const datePicker = document.getElementById("rootdata-date-picker");
      const selectedDate = datePicker ? datePicker.value : null;

      if (!selectedDate) {
        alert("无法获取当前日期");
        return;
      }

      if (
        !confirm(
          `确定要删除【${projectName}】在 ${selectedDate} 新增的所有投资关系记录吗？此操作不可恢复！`
        )
      ) {
        return;
      }

      try {
        const response = await fetch(
          `/api/rootdata/relationships/funded-project/${fundedProjectId}?date=${selectedDate}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        const result = await response.json();
        if (response.ok) {
          alert(`✅ 成功删除 ${result.deletedCount} 条记录`);
          // 重新加载当前日期的数据（保持当前页码）
          loadRootdataDailyStats(rootdataCurrentPage);
        } else {
          alert(`❌ 删除失败: ${result.message || "未知错误"}`);
        }
      } catch (error) {
        console.error("删除失败:", error);
        alert("❌ 删除失败: " + error.message);
      }
    });
  });
}

/**
 * 渲染分页控件
 */
function renderPagination(currentPage, totalPages, type) {
  let html = `
    <div class="rootdata-pagination" style="display: flex; justify-content: center; align-items: center; padding: 20px; gap: 10px;">
      <button class="rootdata-page-btn" data-page="${currentPage - 1}" ${
    currentPage <= 1 ? "disabled" : ""
  } style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
        ← 上一页
      </button>
      <span style="color: #374151; font-weight: 600;">
        第 ${currentPage} / ${totalPages} 页
      </span>
      <button class="rootdata-page-btn" data-page="${currentPage + 1}" ${
    currentPage >= totalPages ? "disabled" : ""
  } style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
        下一页 →
      </button>
    </div>
  `;
  return html;
}

/**
 * 设置当日新增项目为初始项目
 */
async function setDailyProjectsAsInitial() {
  const dateInput = document.getElementById("rootdata-date-picker");
  const selectedDate = dateInput.value;

  if (!selectedDate) {
    alert("请先选择日期");
    return;
  }

  if (!confirm(`确定要将 ${selectedDate} 新增的所有项目设置为初始项目吗？`)) {
    return;
  }

  try {
    const response = await fetch(
      "/api/xhunt/stats/rootdata-daily/set-initial",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: selectedDate }),
      }
    );

    const result = await response.json();

    if (result.success) {
      alert(result.data.message);
      // 重新加载数据以显示更新后的状态
      loadRootdataDailyStats(rootdataCurrentPage);
    } else {
      alert(`设置失败: ${result.message || result.error}`);
    }
  } catch (error) {
    console.error("设置 isInitial 失败:", error);
    alert(`设置失败: ${error.message}`);
  }
}

/**
 * 切换 Rootdata Tab（项目 / 投资关系）
 */
function switchRootdataTab(tabName) {
  // 更新 tab 按钮状态
  document.querySelectorAll(".rootdata-tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document
    .querySelector(`[data-rootdata-tab="${tabName}"]`)
    .classList.add("active");

  // 切换内容显示
  document.querySelectorAll(".rootdata-tab-content").forEach((content) => {
    content.style.display = "none";
  });

  if (tabName === "projects") {
    document.getElementById("rootdata-projects-list").style.display = "block";
  } else if (tabName === "relationships") {
    document.getElementById("rootdata-relationships-list").style.display =
      "block";
  }
}

// ============ Pro 用户管理功能 ============

/**
 * 绑定 Pro 用户管理事件
 */
function bindProManagementEvents() {
  console.log("🔧 开始绑定 Pro 用户管理事件...");

  // 绑定开通 Pro 表单提交事件
  const grantProForm = document.getElementById("grant-pro-form");
  if (grantProForm) {
    grantProForm.addEventListener("submit", handleGrantPro);
    console.log("✅ 开通 Pro 表单事件绑定成功");
  }

  // 绑定刷新列表按钮事件
  const refreshBtn = document.getElementById("refresh-pro-list");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadProUsersList(1));
    console.log("✅ 刷新列表按钮事件绑定成功");
  }

  // 监听 Tab 切换，当切换到 Pro 管理 tab 时加载列表
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");
      if (targetTab === "pro-management") {
        console.log("👑 切换到 Pro 用户管理 Tab，加载用户列表...");
        loadProUsersList(1);
      }
    });
  });
}

/**
 * 处理开通 Pro 表单提交
 */
async function handleGrantPro(event) {
  event.preventDefault();

  const form = event.target;
  const username = form.querySelector("#pro-username").value.trim();
  const durationDays = form.querySelector("#pro-duration").value;
  const reason = form.querySelector("#pro-reason").value.trim();

  if (!username || !durationDays) {
    showGrantResult("请填写用户名和选择开通时长", "error");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="btn-icon">⏳</span> 开通中...';

  try {
    const response = await fetch("/api/xhunt/stats/grant-pro", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username,
        durationDays: parseInt(durationDays),
        reason: reason || "manual",
      }),
    });

    const result = await response.json();

    if (result.success) {
      showGrantResult(
        `✅ ${result.message}<br>` +
          `用户: ${result.data.displayName} (@${result.data.username})<br>` +
          `时长: ${result.data.durationDays} 天<br>` +
          `过期时间: ${new Date(result.data.endTime).toLocaleString("zh-CN")}`,
        "success"
      );
      form.reset();
      // 刷新 Pro 用户列表
      loadProUsersList(1);
    } else {
      showGrantResult(`❌ ${result.message || result.error}`, "error");
    }
  } catch (error) {
    console.error("开通 Pro 失败:", error);
    showGrantResult(`❌ 开通失败: ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">✨</span> 开通 Pro';
  }
}

/**
 * 显示开通结果
 */
function showGrantResult(message, type) {
  const resultDiv = document.getElementById("grant-result");
  const resultContent = resultDiv.querySelector(".result-content");

  resultDiv.className = `result-message ${type}`;
  resultContent.innerHTML = message;
  resultDiv.style.display = "block";

  // 5秒后自动隐藏
  setTimeout(() => {
    resultDiv.style.display = "none";
  }, 5000);
}

/**
 * 加载 Pro 用户列表
 */
let currentProPage = 1;

async function loadProUsersList(page = 1) {
  console.log(`📋 加载 Pro 用户列表，页码: ${page}`);
  currentProPage = page;

  const tbody = document.getElementById("pro-users-tbody");
  const countSpan = document.getElementById("pro-user-count");

  // 显示加载状态
  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; padding: 40px">
        <div class="loading">加载中...</div>
      </td>
    </tr>
  `;

  try {
    const response = await fetch(
      `/api/xhunt/stats/pro-users?page=${page}&limit=50&status=all`
    );
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || result.error);
    }

    const { subscriptions, stats, pagination } = result.data;

    // 更新统计信息
    countSpan.innerHTML = `
      总计: ${stats.total} 个订阅 |
      <span style="color: #28a745">有效: ${stats.totalActive}</span> |
      <span style="color: #dc3545">过期: ${stats.totalExpired}</span>
    `;

    // 渲染表格
    if (subscriptions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 40px; color: #7f8c8d">
            暂无 Pro 用户订阅记录
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = subscriptions
        .map((sub, index) => {
          const startIndex = (pagination.currentPage - 1) * pagination.pageSize;
          const rowNumber = startIndex + index + 1;

          const statusBadge = sub.isActive
            ? '<span class="status-badge active">有效</span>'
            : '<span class="status-badge expired">已过期</span>';

          return `
            <tr>
              <td>${rowNumber}</td>
              <td>${sub.username || "未知"}</td>
              <td>${sub.displayName || "未知"}</td>
              <td>${sub.planType}</td>
              <td>${new Date(sub.startTime).toLocaleString("zh-CN")}</td>
              <td>${new Date(sub.endTime).toLocaleString("zh-CN")}</td>
              <td>${statusBadge}</td>
              <td>${sub.reason}<br><small style="color: #7f8c8d">${
            sub.reasonDetail
          }</small></td>
            </tr>
          `;
        })
        .join("");
    }

    // 渲染分页控件
    renderProPagination(pagination);
  } catch (error) {
    console.error("加载 Pro 用户列表失败:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: #dc3545">
          ❌ 加载失败: ${error.message}
        </td>
      </tr>
    `;
    countSpan.textContent = "加载失败";
  }
}

/**
 * 渲染分页控件
 */
function renderProPagination(pagination) {
  const container = document.getElementById("pro-list-pagination");

  if (pagination.totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const { currentPage, totalPages, totalCount } = pagination;

  let html = `
    <button ${currentPage === 1 ? "disabled" : ""} onclick="loadProUsersList(${
    currentPage - 1
  })">
      上一页
    </button>
    <span class="page-info">
      第 ${currentPage} / ${totalPages} 页 (共 ${totalCount} 条记录)
    </span>
    <button ${
      currentPage === totalPages ? "disabled" : ""
    } onclick="loadProUsersList(${currentPage + 1})">
      下一页
    </button>
  `;

  container.innerHTML = html;
}
