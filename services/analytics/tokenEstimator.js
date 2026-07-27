/**
 * Lightweight token estimate for monitoring only.
 * OpenAI usage values are preferred whenever the API returns them.
 */
function estimateTokens(value) {
  if (!value) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimate(input, output = "") {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

module.exports = { estimate, estimateTokens };
