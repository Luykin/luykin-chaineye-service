const axios = require("axios");

const DEFAULT_ALERT_PUSH_URL =
  "http://65.21.227.58:3001/api/push/PdGpOIEiBa?status=up&msg=OK&ping=";

function getAlertPushUrl() {
  return process.env.ALERT_PUSH_URL || DEFAULT_ALERT_PUSH_URL;
}

async function pushAlertNotification(source = "unknown") {
  const url = getAlertPushUrl();
  if (!url) {
    return { success: false, skipped: true, reason: "ALERT_PUSH_URL_NOT_CONFIGURED" };
  }

  const startedAt = Date.now();

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const durationMs = Date.now() - startedAt;

    console.log("[alertPushService] 告警 push 调用成功:", {
      source,
      status: response.status,
      durationMs,
    });

    return {
      success: true,
      status: response.status,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    console.warn("[alertPushService] 告警 push 调用失败:", {
      source,
      durationMs,
      error: error.message,
    });

    return {
      success: false,
      durationMs,
      error: error.message,
    };
  }
}

module.exports = {
  pushAlertNotification,
};
