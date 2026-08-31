function publicError(code, status = 400, message, extra = {}) {
  const error = new Error(code);
  error.status = status;
  error.publicMessage = message;
  Object.assign(error, extra);
  return error;
}

function sendJsonError(res, error, fallback = "SOCIAL_LISTENING_ERROR") {
  const status = error.status || error.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: error.message || fallback,
    message: error.publicMessage || error.message || fallback,
  });
}

module.exports = { publicError, sendJsonError };
