require("dotenv").config();
const express    = require("express");
const https      = require("https");
const router     = express.Router();
const admin      = require("../config/firebase");

/**
 * POST /api/verify-payment
 *
 * Verifies a Monnify transaction and stamps the subscription in Firestore.
 *
 * Body:
 *   { reference: "RDFY-LITE-XXXXXXXX", plan: "lite" | "monthly" | "annual", uid: "firebaseUid" }
 *
 * Monnify verification:
 *   GET https://sandbox.monnify.com/api/v2/transactions/{encodedReference}
 *   Authorization: Basic base64(apiKey:secretKey)
 *
 * Expected amounts (Naira):
 *   lite    →  700
 *   monthly →  1,200
 *   annual  →  11,376
 */

const MONNIFY_API_KEY    = process.env.MONNIFY_API_KEY    || "MK_TEST_EBEFAAP7KD";
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "FM8ZLQQP9QB6EUPE7DZ8X2E2H8SHSS06";

// Use sandbox URL for test mode — switch to https://api.monnify.com for production
const MONNIFY_BASE_URL = process.env.MONNIFY_ENV === "live"
    ? "api.monnify.com"
    : "sandbox.monnify.com";

const EXPECTED_AMOUNTS = {
    lite:    700,
    monthly: 1200,
    annual:  11376,
};

const TIER_MAP = {
    lite:    "ONLINE",   // maps to Readify Lite subscription tier
    monthly: "PREMIUM",
    annual:  "PREMIUM",
};

/**
 * POST /api/init-payment
 *
 * Creates a Monnify checkout session and returns the hosted payment URL.
 * The Android app opens this URL in a WebView — no Monnify Android SDK needed.
 *
 * Body: { plan: "lite"|"monthly"|"annual", uid: "firebaseUid",
 *         email: "user@email.com", name: "User Name" }
 */
router.post("/init-payment", async (req, res) => {
    const { plan, uid, email, name } = req.body;

    if (!plan || !uid || !email) {
        return res.status(400).json({ success: false, error: "plan, uid and email are required." });
    }

    const amount = EXPECTED_AMOUNTS[plan];
    if (!amount) {
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });
    }

    const reference = `RDFY-${plan.toUpperCase()}-${Date.now()}-${Math.random().toString(36).substr(2,6).toUpperCase()}`;

    try {
        const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString("base64");

        const body = JSON.stringify({
            amount,
            currencyCode: "NGN",
            customerName: name || "Readify User",
            customerEmail: email,
            paymentReference: reference,
            paymentDescription: `Readify ${plan} subscription`,
            contractCode: "0148083898",
            redirectUrl: `https://readify-backend-1.onrender.com/api/payment-callback`,
            paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD", "DIRECT_DEBIT"],
        });

        const result = await monnifyPost("/api/v1/merchant/transactions/init-transaction", body, credentials);

        if (!result || result.requestSuccessful !== true) {
            throw new Error(result?.responseMessage || "Monnify init failed");
        }

        return res.json({
            success: true,
            checkoutUrl: result.responseBody.checkoutUrl,
            transactionReference: result.responseBody.transactionReference,
            paymentReference: reference,
        });

    } catch (err) {
        console.error("[init-payment]", err.message);
        return res.status(500).json({ success: false, error: "Could not create payment session." });
    }
});

/**
 * GET /api/payment-callback
 * Monnify redirects here after payment. The WebView intercepts this URL
 * and the app extracts the transaction reference to verify.
 */
router.get("/payment-callback", (req, res) => {
    const { paymentReference, transactionReference, paymentStatus } = req.query;
    // Return a minimal page — the WebView intercepts this URL before the user sees it
    res.send(`<!DOCTYPE html><html><body>
        <p>Processing payment…</p>
        <script>window.location.href = 'readifypro://payment?ref=${encodeURIComponent(transactionReference || paymentReference || "")}&status=${paymentStatus || ""}';
        </script></body></html>`);
});

router.post("/verify-payment", async (req, res) => {
    const { reference, plan, uid } = req.body;

    if (!reference || !plan || !uid) {
        return res.status(400).json({ success: false, error: "reference, plan and uid are required." });
    }

    const expectedAmount = EXPECTED_AMOUNTS[plan];
    if (!expectedAmount) {
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });
    }

    try {
        // ── 1. Verify with Monnify ────────────────────────────────────
        const monnifyData = await verifyMonnifyTransaction(reference);

        if (!monnifyData || monnifyData.requestSuccessful !== true) {
            return res.status(400).json({ success: false, error: "Could not reach Monnify to verify this transaction." });
        }

        const txn = monnifyData.responseBody;

        // Check payment status
        if (txn.paymentStatus !== "PAID") {
            return res.status(400).json({
                success: false,
                error: `Payment not completed. Status: ${txn.paymentStatus}`
            });
        }

        // Verify amount paid matches what we expect (allow ±1 Naira for rounding)
        const amountPaid = parseFloat(txn.amountPaid || txn.amount || 0);
        if (Math.abs(amountPaid - expectedAmount) > 1) {
            console.warn(`Amount mismatch: expected ₦${expectedAmount}, got ₦${amountPaid} for ref ${reference}`);
            return res.status(400).json({
                success: false,
                error: `Amount mismatch: expected ₦${expectedAmount}, received ₦${amountPaid}`
            });
        }

        // ── 2. Stamp subscription in Firestore ────────────────────────
        const tier     = TIER_MAP[plan];
        const now      = admin.firestore.FieldValue.serverTimestamp();
        const expiryMs = plan === "annual"
            ? Date.now() + 365 * 24 * 60 * 60 * 1000
            : plan === "monthly"
                ? Date.now() + 30 * 24 * 60 * 60 * 1000
                : null; // Lite is one-time, no expiry

        const updateData = {
            subscriptionTier:      tier,
            subscriptionPlan:      plan,
            subscriptionUpdatedAt: now,
            lastPaymentReference:  reference,
            lastPaymentAmount:     amountPaid,
        };
        if (expiryMs) updateData.subscriptionExpiresAt = new Date(expiryMs);

        await admin.firestore()
            .collection("users")
            .doc(uid)
            .set(updateData, { merge: true });

        console.log(`[Subscription] ${uid} upgraded to ${tier} (${plan}) via Monnify ref ${reference}`);

        return res.json({
            success: true,
            tier,
            plan,
            amountPaid,
            expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
        });

    } catch (err) {
        console.error("[verify-payment] Error:", err.message);
        return res.status(500).json({ success: false, error: "Payment verification failed. Please contact support." });
    }
});

// ── Monnify REST API helpers ──────────────────────────────────────────

function monnifyPost(path, body, credentials) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: MONNIFY_BASE_URL,
            path,
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Invalid JSON from Monnify")); }
            });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => reject(new Error("Monnify request timed out")));
        req.write(body);
        req.end();
    });
}

function verifyMonnifyTransaction(reference) {
    return new Promise((resolve, reject) => {
        const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString("base64");
        const encodedRef  = encodeURIComponent(reference);
        const path        = `/api/v2/transactions/${encodedRef}`;

        const options = {
            hostname: MONNIFY_BASE_URL,
            path,
            method: "GET",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type":  "application/json",
            },
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error("Invalid JSON from Monnify")); }
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => reject(new Error("Monnify verification timed out")));
        req.end();
    });
}

module.exports = router;
