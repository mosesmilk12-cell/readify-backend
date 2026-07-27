# AI Analytics Engine

## Added
- Unique `X-AI-Request-ID` response header for protected API requests.
- Firestore event collection: `aiCostEvents`.
- Firestore aggregate collections: `aiMetricsDaily` and `aiMetricsMonthly`.
- Tracking for summary, quiz, tutor, TTS, and transcription.
- Cache hit/miss, estimated tokens, estimated cost, success/failure, and duration.

## Compatibility
Existing response bodies and endpoint URLs are unchanged.

## Firestore note
The backend service account must have permission to write the analytics collections. Analytics failures do not alter the AI response path, except that a Firestore write error is logged.

## Pricing
Prices are estimates stored in `services/analytics/costService.js`. Update them when provider pricing changes.
