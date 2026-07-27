const DEFAULT_PRICING = Object.freeze({
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "gpt-4o-mini-transcribe": { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  "tts-1": { perMillionCharacters: 15.00 },
});

function getPricing(model) {
  return DEFAULT_PRICING[model] || { inputPerMillion: 0, outputPerMillion: 0 };
}

function estimateTextCostUsd({ model, inputTokens = 0, outputTokens = 0 }) {
  const pricing = getPricing(model);
  const inputCost = (Number(inputTokens) / 1_000_000) * (pricing.inputPerMillion || 0);
  const outputCost = (Number(outputTokens) / 1_000_000) * (pricing.outputPerMillion || 0);
  return Number((inputCost + outputCost).toFixed(8));
}

function estimateTtsCostUsd({ model = "tts-1", characters = 0 }) {
  const pricing = getPricing(model);
  return Number(((Number(characters) / 1_000_000) * (pricing.perMillionCharacters || 0)).toFixed(8));
}

module.exports = { estimateTextCostUsd, estimateTtsCostUsd };
