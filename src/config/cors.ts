import type { CorsOptions } from "cors";

const PRODUCTION_FRONTEND = "https://easy-buy-ruddy.vercel.app";

function normalize(origin: string | undefined) {
  return origin?.trim().replace(/\/+$/, "") || null;
}

// Browsers may only call the API from our own frontends.
// Extra origins (e.g. Vercel preview URLs) can be added with
// CORS_ORIGINS="https://a.vercel.app,https://b.vercel.app".
const allowedOrigins = new Set(
  [
    PRODUCTION_FRONTEND,
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS ?? "").split(","),
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
  ]
    .map(normalize)
    .filter((origin): origin is string => origin !== null)
);

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header are not from a browser page
    // (SSLCommerz IPN, Next.js server components, curl) — CORS doesn't apply.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    // Don't throw: just omit the CORS headers so the browser blocks it.
    callback(null, false);
  },
  // Auth uses a Bearer header, not cookies, so credentials stay disabled.
  credentials: false,
};
