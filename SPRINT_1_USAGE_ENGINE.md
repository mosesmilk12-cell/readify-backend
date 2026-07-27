# Sprint 1 — AI Usage Engine (Milestone 1)

## Scope

This milestone introduces server-side AI usage tracking with no Android API contract changes.
Only `POST /api/summarize` is integrated in this first low-risk rollout.

## New modules

- `services/usage/quotaRules.js`
- `services/usage/usageRepository.js`
- `services/usage/usageService.js`
- `middleware/enforceAiQuota.js`

## Firestore structure

```text
aiUsage/{uid}/daily/{YYYY-MM-DD}
```

Example fields:

```json
{
  "uid": "firebase-user-id",
  "dateKey": "2026-07-27",
  "summariesUsed": 2,
  "summaryBonus": 0,
  "updatedAt": "Firestore Timestamp",
  "createdAt": "Firestore Timestamp"
}
```

## Safe rollout mode

The default configuration tracks usage but does not block requests:

```env
AI_USAGE_TRACKING_ENABLED=true
AI_SERVER_QUOTAS_ENABLED=false
AI_QUOTA_FAIL_CLOSED=false
AI_USAGE_TIMEZONE=Africa/Lagos
```

This is intentional. The current Android rewarded-ad credits are local-only. Enforcing the backend limit before adding a secure reward synchronization endpoint would cause the phone and server limits to disagree.

## Current behavior

- Invalid summary requests are rejected before any quota unit is reserved.
- Valid requests reserve one summary unit.
- Cache hits count as one user-visible use, matching the existing Android usage model.
- Failed OpenAI/queue requests release the reserved unit.
- Premium users are marked unlimited, while requests may still be counted for analytics.
- Firestore failures fail open by default, so an outage does not break AI features.

## Deployment

1. Deploy with the default safe-rollout environment values above.
2. Generate summaries using a free account.
3. Confirm documents appear under `aiUsage/{uid}/daily/{date}` in Firestore.
4. Confirm cached and uncached summary responses still use the original `{ "summary": "..." }` format.
5. Keep `AI_SERVER_QUOTAS_ENABLED=false` until the rewarded-ad server flow is implemented and tested.

## Rollback

Set:

```env
AI_USAGE_TRACKING_ENABLED=false
```

No code rollback is required. The summary endpoint will bypass the usage engine.
