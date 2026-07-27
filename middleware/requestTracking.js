const { createRequestId } = require("../services/analytics/requestLogger");

module.exports = function requestTracking(req, res, next) {
  const requestId = String(req.get("X-Request-ID") || "").trim() || createRequestId();
  req.aiRequestId = requestId;
  res.setHeader("X-AI-Request-ID", requestId);
  next();
};
