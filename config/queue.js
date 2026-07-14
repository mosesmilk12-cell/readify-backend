const { Queue, QueueEvents } = require("bullmq");
const { getRedisOptions } = require("./redis");

/**
 * Single queue for all AI requests.
 *
 * Job names:  "summary" | "quiz" | "tts"
 * Concurrency: 5 — at most 5 simultaneous OpenAI calls regardless of how
 *   many HTTP requests arrive. Requests beyond that queue up and wait,
 *   returning a result once a slot is free, rather than hitting a rate limit.
 *
 * This module only defines the queue and queue-events objects used by
 * route handlers to ADD jobs and AWAIT results. The actual processing
 * logic lives in queues/aiWorker.js.
 *
 * Both exports are null when Redis is unavailable (routes fall back to
 * calling OpenAI directly).
 */

let aiQueue = null;
let queueEvents = null;

const producerConnection = getRedisOptions(1);
const eventsConnection = getRedisOptions(null);

if (producerConnection && eventsConnection) {
  aiQueue = new Queue("readify-ai", {
    connection: producerConnection,
    defaultJobOptions: {
      removeOnComplete: 200,   // keep last 200 completed jobs for debugging
      removeOnFail: 100,
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
    },
  });

  queueEvents = new QueueEvents("readify-ai", {
    connection: eventsConnection,
  });

  console.log("[Queue] AI queue ready");
} else {
  console.warn("[Queue] Redis not configured — queue disabled, direct calls only.");
}

module.exports = { aiQueue, queueEvents };
