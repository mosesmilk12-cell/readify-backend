require("dotenv").config();
const express = require("express");
const https   = require("https");
const router  = express.Router();
const admin   = require("../config/firebase");

const MONNIFY_API_KEY    = process.env.MONNIFY_API_KEY    || "MK_TEST_EBEFAAP7KD";
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "FM8ZLQQP9QB6EUPE7DZ8X2E2H8SHSS06";
const MONNIFY_BASE_URL   = process.env.MONNIFY_ENV === "live"
    ? "api.monnify.com"
    : "sandbox.monnify.com";
const CONTRACT_CODE      = process.env.MONNIFY_CONTRACT_CODE || "0148083898";

const EXPECTED_AMOUNTS = { lite: 700, monthly: 1200, annual: 11376 };
const TIER_MAP         = { lite: "ONLINE", monthly: "PREMIUM", annual: "PREMIUM" };

// ── Step 1: get Monnify access token ────────────────────────────────
// Monnify uses Basic Auth ONLY on the /auth/login endpoint to get a
// short-lived Bearer token. All other endpoints require that Bearer token.
async function getMonnifyToken() {
    const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`)
        .toString("base64");

    const data = await monnifyRequest({
        path:   "/api/v1/auth/login",
        method: "POST",
        headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/json",
        },
        body: null,
    });

    if (!data || data.requestSuccessful !== true) {
        const msg = data?.responseMessage || "Monnify auth failed";
        throw new Error(`Monnify auth error: ${msg}`);
    }
    return data.responseBody.accessToken;
}

// ── POST /api/init-payment ────────────────────────────────────────────
router.post("/init-payment", async (req, res) => {
    const { plan, uid, email, name } = req.body;
    if (!plan || !uid || !email)
        return res.status(400).json({ success: false, error: "plan, uid and email are required." });

    const amount = EXPECTED_AMOUNTS[plan];
    if (!amount)
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });

    const reference = `RDFY-${plan.toUpperCase()}-${Date.now()}-${Math.random()
        .toString(36).substr(2, 6).toUpperCase()}`;

    try {
        // Step 1: authenticate
        const token = await getMonnifyToken();

        // Step 2: initialise transaction with Bearer token
        const body = JSON.stringify({
            amount,
            currencyCode:       "NGN",
            customerName:       name || "Readify User",
            customerEmail:      email,
            paymentReference:   reference,
            paymentDescription: `Readify ${plan} subscription`,
            contractCode:       CONTRACT_CODE,
            redirectUrl: `https://readify-backend-1.onrender.com/api/payment-callback`,
            paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
        });

        const result = await monnifyRequest({
            path:   "/api/v1/merchant/transactions/init-transaction",
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type":  "application/json",
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

// ── GET /api/payment-callback ─────────────────────────────────────────
router.get("/payment-callback", (req, res) => {
    const { paymentReference, transactionReference, paymentStatus } = req.query;
    res.send(`<!DOCTYPE html><html><body>
        <p>Processing payment…</p>
        <script>window.location.href='readifypro://payment?ref=${
            encodeURIComponent(transactionReference || paymentReference || "")
        }&status=${paymentStatus || ""}';</script>
    </body></html>`);
});

// ── POST /api/verify-payment ──────────────────────────────────────────
router.post("/verify-payment", async (req, res) => {
    const { reference, plan, uid } = req.body;
    if (!reference || !plan || !uid)
        return res.status(400).json({ success: false, error: "reference, plan and uid are required." });

    const expectedAmount = EXPECTED_AMOUNTS[plan];
    if (!expectedAmount)
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });

    try {
        // Step 1: authenticate
        const token = await getMonnifyToken();

        // Step 2: verify transaction
        const encodedRef = encodeURIComponent(reference);
        const data = await monnifyRequest({
            path:   `/api/v2/transactions/${encodedRef}`,
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` },
            body:   null,
        });

        if (!data || data.requestSuccessful !== true)
            return res.status(400).json({ success: false, error: "Could not verify transaction with Monnify." });

        const txn = data.responseBody;
        if (txn.paymentStatus !== "PAID")
            return res.status(400).json({ success: false, error: `Payment not completed. Status: ${txn.paymentStatus}` });

        const amountPaid = parseFloat(txn.amountPaid || txn.amount || 0);
        if (Math.abs(amountPaid - expectedAmount) > 1) {
            console.warn(`Amount mismatch: expected ₦${expectedAmount}, got ₦${amountPaid}`);
            return res.status(400).json({ success: false, error: `Amount mismatch: expected ₦${expectedAmount}, received ₦${amountPaid}` });
        }

        const tier     = TIER_MAP[plan];
        const now      = admin.firestore.FieldValue.serverTimestamp();
        const expiryMs = plan === "annual"  ? Date.now() + 365 * 86_400_000
                       : plan === "monthly" ? Date.now() +  30 * 86_400_000
                       : null;

        const updateData = {
            subscriptionTier:      tier,
            subscriptionPlan:      plan,
            subscriptionUpdatedAt: now,
            lastPaymentReference:  reference,
            lastPaymentAmount:     amountPaid,
        };
        if (expiryMs) updateData.subscriptionExpiresAt = new Date(expiryMs);

        await admin.firestore().collection("users").doc(uid).set(updateData, { merge: true });

        console.log(`[Subscription] ${uid} → ${tier} (${plan}) ref=${reference}`);
        return res.json({ success: true, tier, plan, amountPaid, expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null });

    } catch (err) {
        console.error("[verify-payment]", err.message);
        return res.status(500).json({ success: false, error: "Payment verification failed. Please contact support." });
    }
});

// ── Generic Monnify HTTPS request ─────────────────────────────────────
function monnifyRequest({ path, method, headers, body }) {
    return new Promise((resolve, reject) => {
        const options = { hostname: MONNIFY_BASE_URL, path, method, headers };
        const req = https.request(options, (res) => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => {
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(new Error(`Monnify returned invalid JSON: ${raw.substring(0, 200)}`)); }
            });
        });
        req.on("error", reject);
        req.setTimeout(15000, () => reject(new Error("Monnify request timed out")));
        if (body) req.write(body);
        req.end();
    });
}

module.exports = router;
