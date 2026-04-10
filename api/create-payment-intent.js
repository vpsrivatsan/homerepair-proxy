import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // Verify auth
  const token = req.headers.authorization?.slice(7);
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: "Invalid session." });

  const { amount, currency } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: "Invalid amount." });

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,           // in cents e.g. 999 = $9.99
      currency: currency || "usd",
      metadata: {
        userId: user.id,
        userEmail: user.email,
        product: "homerepair_analysis"
      },
      receipt_email: user.email,
    });

    // Log payment attempt (no card data stored — Stripe handles that)
    await supabase.from("payments").insert({
      user_id: user.id,
      payment_intent_id: paymentIntent.id,
      amount_cents: amount,
      status: "pending",
      created_at: new Date().toISOString()
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (e) {
    console.error("Stripe error:", e.message);
    res.status(500).json({ error: "Payment setup failed." });
  }
}
