import { createClient } from "@supabase/supabase-js";
import { runMiddleware } from "./_middleware.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GDPR/CCPA compliant data controls
export default async function handler(req, res) {
  const ok = await runMiddleware(req, res);
  if (!ok) return;

  const { action } = req.query;
  const userId = req.user.id;

  try {
    // Get user's data (GDPR right to access)
    if (action === "export" && req.method === "GET") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, created_at, plan, daily_limit")
        .eq("id", userId)
        .single();

      const { data: usageLogs } = await supabase
        .from("usage_logs")
        .select("event, timestamp, tokens")
        .eq("user_id", userId)
        .order("timestamp", { ascending: false })
        .limit(100);

      return res.status(200).json({
        profile,
        usage: usageLogs,
        note: "Report content is never stored. Only usage metadata is kept."
      });
    }

    // Delete all user data (GDPR right to erasure)
    if (action === "delete" && req.method === "DELETE") {
      await supabase.from("usage_logs").delete().eq("user_id", userId);
      await supabase.from("profiles").delete().eq("id", userId);
      await supabase.auth.admin.deleteUser(userId);

      return res.status(200).json({ message: "All your data has been permanently deleted." });
    }

    // Update consent preferences
    if (action === "consent" && req.method === "POST") {
      const { analyticsConsent, marketingConsent } = req.body;
      await supabase.from("profiles").update({
        analytics_consent: !!analyticsConsent,
        marketing_consent: !!marketingConsent,
        consent_updated_at: new Date().toISOString(),
      }).eq("id", userId);

      return res.status(200).json({ message: "Preferences saved." });
    }

    return res.status(400).json({ error: "Invalid action." });
  } catch (e) {
    console.error("Privacy error:", e.message);
    res.status(500).json({ error: "Request failed." });
  }
}
