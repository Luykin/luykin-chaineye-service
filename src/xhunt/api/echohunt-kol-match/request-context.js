const crypto = require("crypto");

function getRequestId(req) {
  return req.requestId || req.headers["x-request-id"] || req.headers["x-xhunt-web-request-id"] || crypto.randomUUID();
}

function getAuthCenterUserId(req) {
  return req.authCenter?.user?.id ? String(req.authCenter.user.id) : "";
}

module.exports = {
  getAuthCenterUserId,
  getRequestId,
};
