function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback?: string): string | undefined {
  return process.env[key] || fallback;
}

export const env = {
  port: parseInt(process.env.PORT || "3001", 10),

  xaiApiKey: required("XAI_API_KEY"),
  grokModel: optional("GROK_MODEL", "grok-3-fast")!,

  xBearerToken: optional("X_BEARER_TOKEN"),

  redditClientId: optional("REDDIT_CLIENT_ID"),
  redditClientSecret: optional("REDDIT_CLIENT_SECRET"),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  resendApiKey: optional("RESEND_API_KEY"),
  resendFrom: optional("RESEND_FROM_EMAIL", "noreply@probekit.com"),

  corsOrigins: (
    optional("CORS_ORIGINS") ||
    "https://probekit-mvp-326.netlify.app,http://localhost:3000"
  ).split(","),
} as const;
