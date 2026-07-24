# Creating Redeem Codes

Codes live in Firestore. Create them in the **Firebase Console → Firestore →
`redeemCodes` collection**, using the code itself (UPPERCASE) as the document ID.

## Document fields

| Field          | Type    | Required | Meaning                                                        |
|----------------|---------|----------|----------------------------------------------------------------|
| `tier`         | string  | yes      | `PREMIUM`, `LITE_YEARLY`, or `ONLINE`                          |
| `durationDays` | number  | yes      | Days of access. Use `0` for no expiry (e.g. lifetime Lite)     |
| `maxUses`      | number  | no       | Total redemptions allowed. `0`/absent = unlimited              |
| `usedCount`    | number  | yes      | Start at `0` — the backend increments this                     |
| `active`       | boolean | yes      | Set `false` to disable a code without deleting it              |
| `expiresAt`    | number  | no       | Millis timestamp after which the code stops working            |

## Examples

**Document ID: `WELCOME30`** — 30 days of Premium, first 500 students
```
tier         = "PREMIUM"
durationDays = 30
maxUses      = 500
usedCount    = 0
active       = true
```

**Document ID: `CAMPUSLAUNCH`** — 1 year ad-free Lite, unlimited uses, expires 31 Dec 2026
```
tier         = "LITE_YEARLY"
durationDays = 365
maxUses      = 0
usedCount    = 0
active       = true
expiresAt    = 1798761600000
```

**Document ID: `PARTNER-LIFETIME`** — permanent Lite access, 50 codes
```
tier         = "ONLINE"
durationDays = 0
maxUses      = 50
usedCount    = 0
active       = true
```

## Built-in protections

- **One redemption per account.** Each use writes
  `redeemCodes/{CODE}/redemptions/{uid}`; a second attempt by the same user is
  rejected with "You have already redeemed this code."
- **Atomic usage counting.** Everything runs inside a Firestore transaction, so
  `maxUses` holds even if many users redeem simultaneously.
- **Never shortens an active plan.** If a user already has time remaining, the
  new days are added on top of their existing expiry rather than replacing it.
- **Server-side only.** The app never decides whether a code is valid, so a
  modified client cannot grant itself a subscription.

## Checking usage

Open `redeemCodes/{CODE}` to see `usedCount`, and the `redemptions`
subcollection to see exactly which accounts redeemed it and when.
