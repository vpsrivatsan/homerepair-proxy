import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Allowed origins — restrict to your domain only
const ALLOWED_ORIGINS = [
  "https://homerepairai.com",
  "https://www.homerepairai.com",
  "https://homerepair-proxy.vercel.app",
];

// ── CORS headers ───────────────────────────────────────────────────────
export function setCORSHeaders(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

// ── Rate limiter ───────────────────────────────────────────────────────
// Max 20 analysis requests per user per day
export async function checkRateLimit(userId) {
  const key = `rate:${userId}:${new Date().toISOString().slice(0, 10)}`; // daily key
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 86400); // expire after 24h
  return { allowed: count <= 20, count, limit: 20 };
}

// Max 5 requests per IP per minute (burst protection)
export async function checkIPRateLimit(ip) {
  const key = `ip:${ip}:${Math.floor(Date.now() / 60000)}`; // per-minute key
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  return { allowed: count <= 5, count };
}

// ── Auth validator ─────────────────────────────────────────────────────
export async function validateAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── Input sanitizer ────────────────────────────────────────────────────
export function sanitizeInput(str, maxLength = 100000) {
  if (typeof str !== "string") return null;
  // Strip null bytes and control characters
  const cleaned = str.replace(/\0/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  if (cleaned.length > maxLength) return null;
  return cleaned;
}

// ── Combined middleware runner ─────────────────────────────────────────
export async function runMiddleware(req, res) {
  setCORSHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(200).end(); return false; }

  // IP rate limit
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const ipLimit = await checkIPRateLimit(ip);
  if (!ipLimit.allowed) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return false;
  }

  // Auth check
  const user = await validateAuth(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }

  // User daily rate limit
  const userLimit = await checkRateLimit(user.id);
  if (!userLimit.allowed) {
    res.status(429).json({
      error: `Daily limit of ${userLimit.limit} analyses reached. Resets at midnight.`,
      remaining: 0
    });
    return false;
  }

  req.user = user;
  req.remainingRequests = userLimit.limit - userLimit.count;
  return true;
}
