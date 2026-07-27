const DEFAULT_PRICING = {
  "gpt-4o-mini": {
    inputPerMillion: Number(process.env.GPT_4O_MINI_INPUT_PER_MILLION_USD || 0.15),
    outputPerMillion: Number(process.env.GPT_4O_MINI_OUTPUT_PER_MILLION_USD || 0.60),
  },
};

function getPricing(model) {
  const fallback = {
    inputPerMillion: Number(process.env.AI_DEFAULT_INPUT_PER_MILLION_USD || 0),
    outputPerMillion: Number(process.env.AI_DEFAULT_OUTPUT_PER_MILLION_USD || 0),
  };
  return DEFAULT_PRICING[model] || fallback;
}

function estimateCostUsd({ model, inputTokens = 0, outputTokens = 0, cached = false }) {
  if (cached) return 0;
  const pricing = getPricing(model);
  const inputCost = (Number(inputTokens) / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (Number(outputTokens) / 1_000_000) * pricing.outputPerMillion;
  return Number((inputCost + outputCost).toFixed(8));
}

module.exports = { estimateCostUsd, getPricing };
