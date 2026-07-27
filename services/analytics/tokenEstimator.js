function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function estimate(input, output) {
  const inputTokens = estimateTextTokens(input);
  const outputTokens = estimateTextTokens(output);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

module.exports = { estimateTextTokens, estimate };
