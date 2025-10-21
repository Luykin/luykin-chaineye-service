// Tab 切换功能
document.addEventListener("DOMContentLoaded", function () {
  // 初始化 Tab 功能
  initTabs();

  // 绑定下载按钮事件
  bindDownloadEvents();

  // 绑定数据导出按钮事件
  bindExportEvents();

  // 自动刷新页面（每5分钟）
  setTimeout(() => {
    window.location.reload();
  }, 5 * 60 * 1000);
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
  // 有灵魂的KOL 下载事件
  const downloadReviewersBtn = document.getElementById("downloadReviewersBtn");
  const downloadReceiversBtn = document.getElementById("downloadReceiversBtn");

  if (downloadReviewersBtn) {
    downloadReviewersBtn.addEventListener("click", downloadReviewersData);
  }

  if (downloadReceiversBtn) {
    downloadReceiversBtn.addEventListener("click", downloadReceiversData);
  }

  // 特定用户下载事件
  const downloadSpecificReviewersBtn = document.getElementById(
    "downloadSpecificReviewersBtn"
  );
  const downloadSpecificReceiversBtn = document.getElementById(
    "downloadSpecificReceiversBtn"
  );

  if (downloadSpecificReviewersBtn) {
    downloadSpecificReviewersBtn.addEventListener(
      "click",
      downloadSpecificReviewersData
    );
  }

  if (downloadSpecificReceiversBtn) {
    downloadSpecificReceiversBtn.addEventListener(
      "click",
      downloadSpecificReceiversData
    );
  }
}

// 绑定数据导出事件
function bindExportEvents() {
  // DAU备份文件导出
  const exportDauFilesBtn = document.getElementById("export-dau-files");
  if (exportDauFilesBtn) {
    exportDauFilesBtn.addEventListener("click", exportDAUFiles);
  }

  // DAU手动备份所有数据
  const backupAllDauBtn = document.getElementById("backup-all-dau");
  if (backupAllDauBtn) {
    backupAllDauBtn.addEventListener("click", backupAllDAUData);
  }

  // 用户Excel导出
  const exportUsersExcelBtn = document.getElementById("export-users-excel");
  if (exportUsersExcelBtn) {
    exportUsersExcelBtn.addEventListener("click", exportUsersExcel);
  }
}

// 下载有灵魂的KOL评论者数据
function downloadReviewersData() {
  console.log("开始下载评论者数据...");
  const reviewers = window.statsData?.kolTagAnalytics?.reviewers || [];
  console.log("评论者数据:", reviewers);
  const csvContent = generateReviewersCSV(reviewers);
  downloadCSV(csvContent, "有灵魂的KOL_评论者名单.csv");
}

// 下载有灵魂的KOL被评论者数据
function downloadReceiversData() {
  console.log("开始下载被评论者数据...");
  const receivers = window.statsData?.kolTagAnalytics?.receivers || [];
  console.log("被评论者数据:", receivers);
  const csvContent = generateReceiversCSV(receivers);
  downloadCSV(csvContent, "有灵魂的KOL_被评论者名单.csv");
}

// 下载特定用户评论者数据
function downloadSpecificReviewersData() {
  console.log("开始下载特定用户评论者数据...");
  const reviewers = window.statsData?.specificUsersAnalytics?.reviewers || [];
  console.log("特定用户评论者数据:", reviewers);
  const csvContent = generateSpecificReviewersCSV(reviewers);
  downloadCSV(csvContent, "特定用户_评论者名单.csv");
}

// 下载特定用户被评论者数据
function downloadSpecificReceiversData() {
  console.log("开始下载特定用户被评论者数据...");
  const receivers = window.statsData?.specificUsersAnalytics?.receivers || [];
  console.log("特定用户被评论者数据:", receivers);
  const csvContent = generateSpecificReceiversCSV(receivers);
  downloadCSV(csvContent, "特定用户_被评论者名单.csv");
}

// 生成有灵魂的KOL评论者CSV内容
function generateReviewersCSV(data) {
  console.log("生成评论者CSV，数据长度:", data.length);
  const headers = [
    "排名",
    "用户名",
    "显示名称",
    "分类",
    "KOL排名",
    "使用次数",
    "是否KOL",
  ];
  const rows = data.map((item, index) => [
    index + 1,
    item.username || "未知",
    item.displayName || item.username || "匿名用户",
    item.classification || "-",
    item.kolRank20W ? item.kolRank20W.toLocaleString() : "-",
    item.tagUsageCount,
    item.isKOL ? "是" : "否",
  ]);

  return generateCSVContent(headers, rows);
}

// 生成有灵魂的KOL被评论者CSV内容
function generateReceiversCSV(data) {
  console.log("生成被评论者CSV，数据长度:", data.length);
  const headers = ["排名", "用户名", "显示名称", "被评次数"];
  const rows = data.map((item, index) => [
    index + 1,
    item.handle || "未知",
    item.displayName || item.handle || "未知账号",
    item.receivedTagCount,
  ]);

  return generateCSVContent(headers, rows);
}

// 生成特定用户评论者CSV内容
function generateSpecificReviewersCSV(data) {
  console.log("生成特定用户评论者CSV，数据长度:", data.length);
  const headers = [
    "排名",
    "用户名",
    "显示名称",
    "分类",
    "KOL排名",
    "评论次数",
    "是否KOL",
  ];
  const rows = data.map((item, index) => [
    index + 1,
    item.username || "未知",
    item.displayName || item.username || "匿名用户",
    item.classification || "-",
    item.kolRank20W ? item.kolRank20W.toLocaleString() : "-",
    item.reviewCount,
    item.isKOL ? "是" : "否",
  ]);

  return generateCSVContent(headers, rows);
}

// 生成特定用户被评论者CSV内容
function generateSpecificReceiversCSV(data) {
  console.log("生成特定用户被评论者CSV，数据长度:", data.length);
  const headers = ["排名", "用户名", "显示名称", "被评论次数"];
  const rows = data.map((item, index) => [
    index + 1,
    item.handle || "未知",
    item.displayName || item.handle || "未知账号",
    item.reviewCount,
  ]);

  return generateCSVContent(headers, rows);
}

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

// 导出DAU备份文件列表
function exportDAUFiles() {
  console.log("开始导出DAU备份文件列表...");

  // 显示加载状态
  showExportStatus("正在获取DAU备份文件列表...");

  // 在新标签页中打开DAU备份文件列表
  const dauBackupUrl = "/api/xhunt/dau-backup/files";
  window.open(dauBackupUrl, "_blank");

  // 隐藏加载状态
  setTimeout(() => {
    hideExportStatus();
  }, 1000);
}

// 手动备份所有DAU数据
function backupAllDAUData() {
  console.log("开始手动备份所有DAU数据...");

  // 确认操作
  if (
    !confirm(
      "确定要备份Redis中所有DAU数据吗？\n\n注意：同一天的数据会被覆盖写入。"
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
  fetch("/api/xhunt/dau-backup/backup-all", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("备份结果:", data);

      if (data.success) {
        alert(
          `备份成功！\n\n${
            data.message
          }\n\n备份的日期：${data.data.backedUpDates.join(", ")}`
        );
      } else {
        alert(`备份失败：${data.message}`);
      }
    })
    .catch((error) => {
      console.error("备份请求失败:", error);
      alert("备份请求失败: " + error.message);
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
