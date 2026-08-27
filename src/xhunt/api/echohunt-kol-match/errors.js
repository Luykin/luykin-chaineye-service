function publicError(code, status = 400, publicMessage, data = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.publicMessage = publicMessage;
  error.data = data;
  return error;
}

function sendError(res, error, fallbackCode = "KOL_MATCH_FAILED") {
  const status = error.status || (error.code === "PG_READ_NOT_CONFIGURED" ? 503 : 500);
  const code = error.code || error.message || fallbackCode;
  const publicMessage = error.publicMessage || (
    status === 429
      ? "今日次数已用完，请明天再试。"
      : status === 503
        ? "KOL Match 服务暂不可用，请稍后再试。"
        : status >= 500
          ? "KOL Match 处理失败，请稍后重试。"
          : "请求参数不符合要求，请检查后重试。"
  );

  return res.status(status).json({
    success: false,
    error: code,
    message: publicMessage,
    data: {
      ...(error.data || {}),
      quotaCharged: false,
    },
  });
}

function isPgStatementTimeout(error) {
  const code = error?.parent?.code || error?.original?.code || error?.code;
  const message = error?.parent?.message || error?.original?.message || error?.message || "";
  return code === "57014" || /statement timeout|canceling statement due to statement timeout/i.test(message);
}

function normalizeKolMatchError(error, fallbackCode = "KOL_MATCH_FAILED") {
  if (!error || typeof error !== "object") return error;
  if (isPgStatementTimeout(error)) {
    error.code = `${fallbackCode}_TIMEOUT`;
    error.status = 504;
    error.publicMessage = "筛选耗时较长，请稍后重试或适当放宽筛选条件。";
    error.data = {
      ...(error.data || {}),
      reason: "PG_STATEMENT_TIMEOUT",
    };
  }
  return error;
}

function isConfigError(error) {
  return [
    "PG_READ_NOT_CONFIGURED",
    "PG_READ_CONNECTED_TO_PRIMARY",
    "VECTOR_EMBEDDING_NOT_CONFIGURED",
    "VECTOR_EMBEDDING_DIMENSION_MISMATCH",
  ].includes(error?.code || error?.message);
}

module.exports = {
  isConfigError,
  isPgStatementTimeout,
  normalizeKolMatchError,
  publicError,
  sendError,
};
