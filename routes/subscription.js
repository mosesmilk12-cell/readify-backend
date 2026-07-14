const express = require("express");
const router  = express.Router();
const https   = require("https");
const admin   = require("../config/firebase");
const requireAuth = require("../middleware/requireAuth");

// ── Monnify config ────────────────────────────────────────────────────────────
const MONNIFY_API_KEY     = process.env.MONNIFY_API_KEY    || "MK_TEST_EBEFAAP7KD";
const MONNIFY_SECRET_KEY  = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT    = process.env.MONNIFY_CONTRACT_CODE || "0148083898";
const MONNIFY_BASE        = process.env.MONNIFY_ENV === "live"
    ? "api.monnify.com"
    : "sandbox.monnify.com";
const PUBLIC_BACKEND_URL  = process.env.PUBLIC_BACKEND_URL || "https://readify-backend-1.onrender.com";
const WEB_APP_URL         = process.env.WEB_APP_URL || "https://readifypro.com.ng/app.html";

const PLAN_AMOUNTS = { lite: 700, lite_yearly: 1000, monthly: 1200, annual: 11376 };
const PLAN_TIERS   = { lite: "ONLINE", lite_yearly: "LITE_YEARLY", monthly: "PREMIUM", annual: "PREMIUM" };

// ── Monnify helpers ───────────────────────────────────────────────────────────

/**
 * Step 1 — Exchange API Key + Secret for a short-lived Bearer token.
 * Monnify uses Basic Auth ONLY on this endpoint.
 */
async function getMonnifyToken() {
    if (!MONNIFY_SECRET_KEY) throw new Error("MONNIFY_SECRET_KEY is not set in environment.");

    const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString("base64");

    const data = await monnifyRequest({
        path:    "/api/v1/auth/login",
        method:  "POST",
        headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type":  "application/json",
        },
        body: null,
    });

    if (!data || data.requestSuccessful !== true) {
        throw new Error(`Monnify auth failed: ${data?.responseMessage || "unknown error"}`);
    }

    return data.responseBody.accessToken;
}

/** Generic HTTPS request to Monnify. Returns parsed JSON. */
function monnifyRequest({ path, method, headers, body }) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: MONNIFY_BASE,
            path,
            method,
            headers: headers || {},
        };

        const req = https.request(options, (response) => {
            let raw = "";
            response.on("data", chunk => { raw += chunk; });
            response.on("end", () => {
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error(`Monnify returned non-JSON: ${raw.substring(0, 200)}`));
                }
            });
        });

        req.on("error", reject);
        req.setTimeout(20000, () => reject(new Error("Monnify request timed out")));

        if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
        req.end();
    });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/init-payment
// Body: { plan, uid, email, name? }
// Returns: { success, checkoutUrl, transactionReference, paymentReference }
// ────────────────────────────────────────────────────────────────────────────
router.post("/init-payment", requireAuth, async (req, res) => {
    const { plan, uid, email, name } = req.body;
    const platform = req.body.platform === "web" ? "web" : "android";

    if (uid !== req.user.uid || email !== req.user.email) {
        return res.status(403).json({ success: false, error: "Account details do not match the signed-in user." });
    }

    if (!plan || !uid || !email) {
        return res.status(400).json({ success: false, error: "plan, uid and email are required." });
    }

    const amount = PLAN_AMOUNTS[plan];
    if (!amount) {
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });
    }

    const reference = `RDFY-${plan.toUpperCase()}-${Date.now()}-${Math.random()
        .toString(36).substr(2, 6).toUpperCase()}`;

    try {
        // Step 1: get Bearer token
        const token = await getMonnifyToken();

        // Step 2: initialise transaction
        const callbackQuery = new URLSearchParams({ platform, plan }).toString();
        const body = JSON.stringify({
            amount,
            currencyCode:       "NGN",
            customerName:       name || "Readify User",
            customerEmail:      email,
            paymentReference:   reference,
            paymentDescription: `Readify ${plan} subscription`,
            contractCode:       MONNIFY_CONTRACT,
            redirectUrl:        `${PUBLIC_BACKEND_URL}/api/payment-callback?${callbackQuery}`,
            paymentMethods:     ["CARD", "ACCOUNT_TRANSFER", "USSD"],
        });

        const result = await monnifyRequest({
            path:   "/api/v1/merchant/transactions/init-transaction",
            method: "POST",
            headers: {
                "Authorization":  `Bearer ${token}`,
                "Content-Type":   "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
            body,
        });

        if (!result || result.requestSuccessful !== true) {
            const msg = result?.responseMessage || "Monnify rejected the payment request";
            console.error("[init-payment] Monnify error:", msg, result);
            return res.status(502).json({ success: false, error: msg });
        }

        return res.json({
            success:              true,
            checkoutUrl:          result.responseBody.checkoutUrl,
            transactionReference: result.responseBody.transactionReference,
            paymentReference:     reference,
        });

    } catch (err) {
        console.error("[init-payment]", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/verify-payment
// Body: { reference, plan, uid }
// Verifies the transaction and upgrades the user tier in Firestore.
// ────────────────────────────────────────────────────────────────────────────
router.post("/verify-payment", requireAuth, async (req, res) => {
    const { reference, plan, uid } = req.body;

    if (uid !== req.user.uid) {
        return res.status(403).json({ success: false, error: "Account details do not match the signed-in user." });
    }

    if (!reference || !plan || !uid) {
        return res.status(400).json({ success: false, error: "reference, plan and uid are required." });
    }

    const expectedAmount = PLAN_AMOUNTS[plan];
    if (!expectedAmount) {
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });
    }

    try {
        // Step 1: get Bearer token
        const token = await getMonnifyToken();

        // Step 2: verify transaction (v2 endpoint uses URL-encoded reference)
        const encodedRef = encodeURIComponent(reference);
        const result = await monnifyRequest({
            path:    `/api/v2/transactions/${encodedRef}`,
            method:  "GET",
            headers: { "Authorization": `Bearer ${token}` },
            body:    null,
        });

        if (!result || result.requestSuccessful !== true) {
            return res.status(400).json({
                success: false,
                error:   "Could not verify transaction with Monnify.",
            });
        }

        const txn = result.responseBody;

        if (txn.paymentStatus !== "PAID") {
            return res.status(400).json({
                success: false,
                error:   `Payment not completed. Status: ${txn.paymentStatus}`,
            });
        }

        const amountPaid = parseFloat(txn.amountPaid || txn.amount || 0);
        if (Math.abs(amountPaid - expectedAmount) > 1) {
            console.warn(`[verify-payment] Amount mismatch: expected ₦${expectedAmount}, got ₦${amountPaid}`);
            return res.status(400).json({
                success: false,
                error:   `Amount mismatch. Expected ₦${expectedAmount}, received ₦${amountPaid}`,
            });
        }

        // Step 3: upgrade user in Firestore
        const tier     = PLAN_TIERS[plan];
        const now      = admin.firestore.FieldValue.serverTimestamp();
        const expiryMs = plan === "annual" || plan === "lite_yearly" ? Date.now() + 365 * 86_400_000
                       : plan === "monthly" ? Date.now() +  30 * 86_400_000
                       : null;   // lite is lifetime — no expiry

        const updateData = {
            subscriptionTier:      tier,
            subscriptionPlan:      plan,
            subscriptionUpdatedAt: now,
            premiumPlan:           plan,
            premiumExpiryMs:       expiryMs || 0,
            lastPaymentReference:  reference,
            lastPaymentAmount:     amountPaid,
        };
        if (expiryMs) updateData.subscriptionExpiresAt = new Date(expiryMs);

        await admin.firestore()
            .collection("users")
            .doc(uid)
            .set(updateData, { merge: true });

        console.log(`[verify-payment] ✅ ${uid} → ${tier} (${plan}) ref=${reference}`);

        return res.json({
            success:   true,
            tier,
            plan,
            amountPaid,
            premiumExpiryMs: expiryMs || 0,
            expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
        });

    } catch (err) {
        console.error("[verify-payment]", err.message);
        return res.status(500).json({
            success: false,
            error:   "Payment verification failed. Please contact support@readifypro.com.ng",
        });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/payment-callback
// Monnify redirects here after checkout completes.
// Passes data back to the Android app via a deep link.
// ────────────────────────────────────────────────────────────────────────────
router.get("/payment-callback", (req, res) => {
    const {
        paymentReference,
        transactionReference,
        paymentStatus,
        platform,
        plan,
    } = req.query;

    const rawRef = transactionReference || paymentReference || "";
    const safePlan = Object.prototype.hasOwnProperty.call(PLAN_AMOUNTS, plan) ? plan : "";
    const status = paymentStatus || "";

    if (platform === "web") {
        const returnUrl = new URL(WEB_APP_URL);
        if (rawRef) returnUrl.searchParams.set("paymentReference", rawRef);
        if (safePlan) returnUrl.searchParams.set("plan", safePlan);
        if (status) returnUrl.searchParams.set("paymentStatus", status);
        returnUrl.hash = "subscription";
        return res.redirect(303, returnUrl.toString());
    }

    const deepLink = `readifypro://payment?${new URLSearchParams({ ref: rawRef, status, plan: safePlan }).toString()}`;

    // Open the Readify app via deep link; fallback to a simple HTML page
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Payment Processing — Readify Pro</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
           align-items: center; height: 100vh; margin: 0; background: #EBF2FF; }
    .card { background: white; border-radius: 16px; padding: 36px 28px; max-width: 360px;
            text-align: center; box-shadow: 0 4px 24px rgba(21,101,192,.12); }
    h2 { color: #1565C0; margin-bottom: 12px; }
    p  { color: #475569; font-size: 14px; line-height: 1.6; }
  </style>
  <script>
    // Try to open the app via deep link
    window.location.href = '${deepLink}';
  </script>
</head>
<body>
  <div class="card">
    <h2>Payment Processing…</h2>
    <p>Returning you to Readify Pro.<br/>
       If the app doesn't open, choose an option below.</p>
    <p><a href="${deepLink}">Open Android app</a><br/><br/>
       <a href="${WEB_APP_URL}">Open Readify web app</a></p>
  </div>
</body>
</html>`);
});

module.exports = router;
