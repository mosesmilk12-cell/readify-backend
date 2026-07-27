# Sprint 1 — AI Analytics Milestone

## Added

- Request IDs returned in `X-AI-Request-ID`
- Token estimation with API usage preferred when available
- Cost estimation by model
- Firestore event ledger: `aiCostEvents/{requestId}`
- Daily aggregation: `aiMetricsDaily/{YYYY-MM-DD}`
- Monthly aggregation: `aiMetricsMonthly/{YYYY-MM}`
- Summary cache hit/miss tracking
- Success/failure and duration tracking

## Environment variables

```env
AI_ANALYTICS_ENABLED=true
GPT_4O_MINI_INPUT_PER_MILLION_USD=0.15
GPT_4O_MINI_OUTPUT_PER_MILLION_USD=0.60
AI_DEFAULT_INPUT_PER_MILLION_USD=0
AI_DEFAULT_OUTPUT_PER_MILLION_USD=0
```

`AI_ANALYTICS_ENABLED=false` disables Firestore analytics writes without affecting AI requests.

## Compatibility

The summary JSON response remains unchanged. The new request ID is provided only as a response header.

## Test checklist

1. Send an authenticated summary request with uncached text.
2. Confirm the response is `{ "summary": "..." }`.
3. Confirm `X-AI-Request-ID` exists.
4. Check `aiCostEvents`, `aiMetricsDaily`, and `aiMetricsMonthly` in Firestore.
5. Repeat the same request and verify `cached: true` and zero cost for the second event.
6. Set `AI_ANALYTICS_ENABLED=false` and confirm summary generation still works.
