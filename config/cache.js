const crypto = require("crypto");
const { redis } = require("./redis");

/**
 * Cache TTLs (seconds):
 *
 *   summary   86400  — 24h   Same text always produces the same summary
 *   quiz      21600  —  6h   Same text+params → same questions
 *   tts        3600  —  1h   Same text+voice  → same audio bytes
 *   tutor      none  —  —    Conversational — never cache
 */
const TTL = {
  summary: 86_400,
  quiz:    21_600,
  tts:      3_600,
};

/**
 * Build a stable, fixed-length cache key from a prefix + arbitrary content.
 * Uses SHA-256 so even large bodies produce a short key.
 *
 *   key("summary", text)       → "rdy:summary:a3f9..."  (40 chars)
 *   key("quiz", text+params)   → "rdy:quiz:b1c2..."
 */
function buildKey(prefix, ...parts) {
  const hash = crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .substring(0, 32);
  return `rdy:${prefix}:${hash}`;
}

/**
 * Try to return a cached value.
 * Returns the parsed object on hit, or null on miss / Redis unavailable.
 */
async function getCache(prefix, ...keyParts) {
  if (!redis) return null;
  try {
    const raw = await redis.get(buildKey(prefix, ...keyParts));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;   // cache miss beats a crash
  }
}

/**
 * Store a value in the cache with the appropriate TTL for this prefix.
 * Silent no-op if Redis is unavailable or prefix has no TTL defined.
 */
async function setCache(prefix, value, ...keyParts) {
  if (!redis) return;
  const ttl = TTL[prefix];
  if (!ttl) return;
  try {
    await redis.setex(buildKey(prefix, ...keyParts), ttl, JSON.stringify(value));
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Cache for binary TTS audio (stored as base64 to survive JSON round-trip).
 * Only used by the TTS route — all other routes use getCache/setCache above.
 */
async function getTTSCache(text, voiceStyle) {
  if (!redis) return null;
  try {
    const raw = await redis.get(buildKey("tts", text, voiceStyle));
    if (!raw) return null;
    return Buffer.from(raw, "base64");
  } catch {
    return null;
  }
}

async function setTTSCache(text, voiceStyle, audioBuffer) {
  if (!redis) return;
  try {
    await redis.setex(
      buildKey("tts", text, voiceStyle),
      TTL.tts,
      audioBuffer.toString("base64")
    );
  } catch {
    // Non-fatal
  }
}

module.exports = { getCache, setCache, getTTSCache, setTTSCache };
