const crypto = require("crypto");

function createRequestTracker(feature) {
  const startedAt = Date.now();
  const requestId = `AI-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  return {
    requestId,
    feature,
    startedAt,
    durationMs() {
      return Date.now() - startedAt;
    },
  };
}

module.exports = { createRequestTracker };
