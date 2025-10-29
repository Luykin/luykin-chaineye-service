// Tab 切换功能
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 DOMContentLoaded 事件触发");

  try {
    // 初始化 Tab 功能
    initTabs();

    // 绑定下载按钮事件
    bindDownloadEvents();

    // 绑定数据导出按钮事件
    bindExportEvents();

    // 绑定 Rootdata 页面事件
    bindRootdataEvents();

    // 自动刷新页面（每10分钟）
    setTimeout(() => {
      window.location.reload();
    }, 10 * 60 * 1000);

    console.log("✅ 所有初始化完成");
  } catch (error) {
    console.error("❌ 初始化过程中出错:", error);
  }
});

// 初始化 Tab 功能
function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const targetTab = this.getAttribute("data-tab");

      // 移除所有活跃状态
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      // 添加活跃状态
      this.classList.add("active");
      document.getElementById(targetTab).classList.add("active");
    });
  });
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

  // DAU手动备份所有数据
  const backupAllDauBtn = document.getElementById("backup-all-dau");
  if (backupAllDauBtn) {
    backupAllDauBtn.addEventListener("click", backupAllDAUData);
    console.log("✅ 备份按钮事件绑定成功");
  } else {
    console.error("❌ 未找到备份按钮");
  }

  // 下载最新备份文件
  const downloadLatestBackupBtn = document.getElementById(
    "download-latest-backup"
  );
  if (downloadLatestBackupBtn) {
    downloadLatestBackupBtn.addEventListener("click", downloadLatestBackup);
    console.log("✅ 下载按钮事件绑定成功");
  } else {
    console.error("❌ 未找到下载按钮");
  }

  // 用户Excel导出
  const exportUsersExcelBtn = document.getElementById("export-users-excel");
  if (exportUsersExcelBtn) {
    exportUsersExcelBtn.addEventListener("click", exportUsersExcel);
    console.log("✅ Excel导出按钮事件绑定成功");
  } else {
    console.error("❌ 未找到Excel导出按钮");
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

// 手动备份所有DAU数据
function backupAllDAUData() {
  console.log("开始手动备份所有DAU数据...");

  // 确认操作
  if (
    !confirm(
      "确定要备份Redis中所有DAU数据吗？\n\n将生成一个包含所有唯一用户的累加备份文件。"
    )
  ) {
    return;
  }

  // 显示加载状态
  showExportStatus("正在备份所有DAU数据，请稍候...");

  // 禁用按钮防止重复点击
  const backupBtn = document.getElementById("backup-all-dau");
  if (backupBtn) {
    backupBtn.disabled = true;
    backupBtn.innerHTML = '<span class="btn-icon">⏳</span>正在备份...';
  }

  // 发送备份请求
  console.log("🔄 发送备份请求到: /api/xhunt/dau-backup/backup-all");

  fetch("/api/xhunt/dau-backup/backup-all", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      console.log("📡 收到响应:", response.status, response.statusText);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log("📊 备份结果:", data);

      if (data.success) {
        // 显示详细的成功消息和下载选项
        const message = `备份成功！\n\n${data.message}\n\n详细统计：\n- 总用户数：${data.data.totalUsers}\n- 总记录数：${data.data.totalRecords}\n- 新增用户：${data.data.addedUsers}\n- 更新用户：${data.data.updatedUsers}\n- 新记录数：${data.data.newRecords}\n\n文件名：${data.data.fileName}\n\n是否立即下载备份文件？`;

        const downloadConfirm = confirm(message);

        if (downloadConfirm) {
          downloadLatestBackup();
        }
      } else {
        alert(`备份失败：${data.message}`);
      }
    })
    .catch((error) => {
      console.error("❌ 备份请求失败:", error);
      alert(
        `备份请求失败：${error.message}\n\n请检查：\n1. 后端服务是否运行\n2. 网络连接是否正常\n3. 控制台是否有更多错误信息`
      );
    })
    .finally(() => {
      // 隐藏加载状态
      hideExportStatus();

      // 恢复按钮状态
      if (backupBtn) {
        backupBtn.disabled = false;
        backupBtn.innerHTML =
          '<span class="btn-icon">💾</span>手动备份所有DAU数据';
      }
    });
}

// 下载最新的备份文件
function downloadLatestBackup() {
  console.log("🔄 开始下载最新备份文件...");

  // 显示加载状态
  showExportStatus("正在下载备份文件...");

  // 创建下载链接
  const downloadUrl = "/api/xhunt/dau-backup/download-latest";
  console.log("📥 下载链接:", downloadUrl);

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.style.display = "none";

  // 添加错误处理
  link.onerror = function () {
    console.error("❌ 下载失败");
    alert(
      "下载失败，请检查：\n1. 备份文件是否存在\n2. 后端服务是否运行\n3. 网络连接是否正常"
    );
    hideExportStatus();
  };

  // 添加到页面并触发下载
  document.body.appendChild(link);
  link.click();

  // 清理
  setTimeout(() => {
    try {
      document.body.removeChild(link);
    } catch (e) {
      console.log("清理下载链接时出错:", e);
    }
    hideExportStatus();
  }, 2000);

  console.log("✅ 下载请求已发送");
}

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

  // 初始化日期选择器为今天
  const dateInput = document.getElementById("rootdata-date-picker");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
  }
}

// 当前分页状态
let rootdataCurrentPage = 1;
let rootdataSelectedDate = null;

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
      : "未抓取";
    const failures = project.detailFailuresNumber || 0;
    const fetchStatusColor =
      failures === 0 ? "#10b981" : failures < 3 ? "#f59e0b" : "#ef4444";
    const fetchStatus = `
      <div style="font-size: 12px;">
        <div style="color: ${fetchStatusColor}; font-weight: 600;">失败: ${failures}次</div>
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
              ? `<img src="${project.logo}" alt="${project.projectName}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">`
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
                ? `<img src="${rel.investorProject.logo}" alt="${rel.investorProject.projectName}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
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
                ? `<img src="${rel.fundedProject.logo}" alt="${rel.fundedProject.projectName}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
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
