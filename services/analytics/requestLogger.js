const crypto = require("crypto");

function createRequestId() {
  return `AI-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function start(feature, req) {
  return {
    requestId: req?.aiRequestId || createRequestId(),
    feature,
    startedAt: Date.now(),
  };
}

function finish(tracker, extra = {}) {
  return {
    requestId: tracker.requestId,
    feature: tracker.feature,
    durationMs: Math.max(0, Date.now() - tracker.startedAt),
    ...extra,
  };
}

module.exports = { createRequestId, start, finish };
