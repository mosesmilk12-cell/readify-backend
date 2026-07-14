require("dotenv").config();
const Redis = require("ioredis");

/**
 * Shared Redis connection used by:
 *   - BullMQ queue + worker (job queueing)
 *   - Cache middleware (response caching)
 *
 * Required env var: REDIS_URL
 *   Render Redis:  redis://red-xxxx:6379
 *   Upstash:       rediss://default:xxxx@xxxx.upstash.io:6379
 *   Local dev:     redis://localhost:6379
 *
 * If REDIS_URL is not set the module exports null connections and
 * all callers degrade gracefully (no caching, no queuing).
 */

let redis = null;
let isConnected = false;

function getRedisOptions(maxRetriesPerRequest = null) {
  const raw = process.env.REDIS_URL;
  if (!raw) return null;
  const parsed = new URL(raw);
  const dbPart = parsed.pathname && parsed.pathname !== "/" ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(dbPart) ? dbPart : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest,
    enableReadyCheck: false,
    retryStrategy: times => Math.min(times * 500, 3000),
  };
}

function createConnection(name) {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const opts = {
    maxRetriesPerRequest: null,   // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy: (times) => {
      if (times > 5) return null;  // stop retrying after 5 attempts
      return Math.min(times * 500, 3000);
    },
  };

  const client = new Redis(url, opts);

  client.on("connect", () => {
    if (name === "main") {
      isConnected = true;
      console.log("[Redis] Connected");
    }
  });

  client.on("error", (err) => {
    if (name === "main" && isConnected) {
      console.warn("[Redis] Connection error:", err.message);
      isConnected = false;
    }
  });

  return client;
}

if (process.env.REDIS_URL) {
  redis = createConnection("main");
} else {
  console.warn("[Redis] REDIS_URL not set — caching and queuing disabled.");
}

module.exports = { redis, getRedisOptions, get isConnected() { return isConnected; } };
