// 全局测试函数
window.debugButtons = function () {
  console.log("🔍 开始调试按钮...");

  const backupBtn = document.getElementById("backup-all-dau");
  const downloadBtn = document.getElementById("download-latest-backup");
  const excelBtn = document.getElementById("export-users-excel");

  console.log("备份按钮:", backupBtn);
  console.log("下载按钮:", downloadBtn);
  console.log("Excel按钮:", excelBtn);

  if (backupBtn) {
    console.log("备份按钮位置:", backupBtn.getBoundingClientRect());
    console.log("备份按钮样式:", window.getComputedStyle(backupBtn));
  }

  // 尝试直接添加事件
  if (backupBtn) {
    backupBtn.onclick = function () {
      console.log("🔥 通过onclick触发！");
      alert("onclick测试成功！");
    };
  }
};

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

    // 自动刷新页面（每5分钟）
    setTimeout(() => {
      window.location.reload();
    }, 5 * 60 * 1000);

    console.log("✅ 所有初始化完成");

    // 延迟调试
    setTimeout(() => {
      window.debugButtons();
    }, 1000);
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
  console.log("🔧 开始绑定数据导出事件...");

  // DAU手动备份所有数据
  const backupAllDauBtn = document.getElementById("backup-all-dau");
  console.log("🔍 查找备份按钮:", backupAllDauBtn);
  console.log("🔍 备份按钮位置:", backupAllDauBtn?.offsetParent);
  console.log(
    "🔍 备份按钮可见性:",
    backupAllDauBtn?.offsetWidth,
    backupAllDauBtn?.offsetHeight
  );

  if (backupAllDauBtn) {
    // 先添加一个简单的测试事件
    backupAllDauBtn.addEventListener("click", function (e) {
      console.log("🔥 备份按钮被点击了！");
      e.preventDefault();
      e.stopPropagation();
      alert("备份按钮点击测试成功！");
    });
    console.log("✅ 备份按钮事件绑定成功");

    // 测试直接调用
    console.log("🧪 测试直接调用函数...");
    window.testBackupClick = function () {
      console.log("🔥 直接调用测试成功！");
      alert("直接调用测试成功！");
    };
  } else {
    console.error("❌ 未找到备份按钮");
  }

  // 下载最新备份文件
  const downloadLatestBackupBtn = document.getElementById(
    "download-latest-backup"
  );
  console.log("🔍 查找下载按钮:", downloadLatestBackupBtn);
  if (downloadLatestBackupBtn) {
    // 先添加一个简单的测试事件
    downloadLatestBackupBtn.addEventListener("click", function (e) {
      console.log("🔥 下载按钮被点击了！");
      e.preventDefault();
      alert("下载按钮点击测试成功！");
    });
    console.log("✅ 下载按钮事件绑定成功");
  } else {
    console.error("❌ 未找到下载按钮");
  }

  // 用户Excel导出
  const exportUsersExcelBtn = document.getElementById("export-users-excel");
  console.log("🔍 查找Excel导出按钮:", exportUsersExcelBtn);
  if (exportUsersExcelBtn) {
    exportUsersExcelBtn.addEventListener("click", exportUsersExcel);
    console.log("✅ Excel导出按钮事件绑定成功");
  } else {
    console.error("❌ 未找到Excel导出按钮");
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

// 已删除 exportDAUFiles 函数 - 不再需要查看文件列表功能

// 手动备份所有DAU数据
function backupAllDAUData() {
  console.log("🚀 backupAllDAUData 函数被调用");
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

// 下载最新的备份文件
function downloadLatestBackup() {
  console.log("🚀 downloadLatestBackup 函数被调用");
  console.log("开始下载最新备份文件...");

  // 显示加载状态
  showExportStatus("正在下载备份文件...");

  // 创建下载链接
  const downloadUrl = "/api/xhunt/dau-backup/download-latest";
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.style.display = "none";

  // 添加到页面并触发下载
  document.body.appendChild(link);
  link.click();

  // 清理
  setTimeout(() => {
    document.body.removeChild(link);
    hideExportStatus();
  }, 2000);

  console.log("下载请求已发送");
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
