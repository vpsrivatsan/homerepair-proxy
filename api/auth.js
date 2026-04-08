import { createClient } from "@supabase/supabase-js";
import { setCORSHeaders, sanitizeInput } from "./_middleware.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;

  // Sanitize inputs
  const email = sanitizeInput(req.body?.email, 254);
  const password = sanitizeInput(req.body?.password, 128);

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }

  // Password strength: min 8 chars, at least one number and one letter
  if (action === "signup" && (password.length < 8 || !/[0-9]/.test(password) || !/[a-zA-Z]/.test(password))) {
    return res.status(400).json({ error: "Password must be at least 8 characters with letters and numbers." });
  }

  try {
    if (action === "signup") {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // require email verification
      });
      if (error) throw error;

      // Create user profile in database (no PII beyond email)
      await supabase.from("profiles").insert({
        id: data.user.id,
        created_at: new Date().toISOString(),
        plan: "free",
        daily_limit: 20,
      });

      return res.status(201).json({ message: "Account created. Please verify your email." });
    }

    if (action === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Don't reveal if email exists or not
        return res.status(401).json({ error: "Invalid email or password." });
      }
      return res.status(200).json({
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        userId: data.user.id,
      });
    }

    if (action === "logout") {
      const token = req.headers.authorization?.slice(7);
      if (token) await supabase.auth.admin.signOut(token);
      return res.status(200).json({ message: "Logged out." });
    }

    if (action === "refresh") {
      const refreshToken = sanitizeInput(req.body?.refreshToken, 500);
      if (!refreshToken) return res.status(400).json({ error: "Refresh token required." });
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error) return res.status(401).json({ error: "Session expired. Please log in again." });
      return res.status(200).json({
        token: data.session.access_token,
        expiresAt: data.session.expires_at,
      });
    }

    return res.status(400).json({ error: "Invalid action." });
  } catch (e) {
    console.error("Auth error:", e.message);
    return res.status(500).json({ error: "Authentication failed." });
  }
}
