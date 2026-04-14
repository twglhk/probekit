// src/index.ts
import { serve } from "@hono/node-server";
import { Hono as Hono2 } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// src/env.ts
function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}
function optional(key, fallback) {
  return process.env[key] || fallback;
}
var env = {
  port: parseInt(process.env.PORT || "3001", 10),
  xaiApiKey: required("XAI_API_KEY"),
  grokModel: optional("GROK_MODEL", "grok-3-fast"),
  xBearerToken: optional("X_BEARER_TOKEN"),
  redditClientId: optional("REDDIT_CLIENT_ID"),
  redditClientSecret: optional("REDDIT_CLIENT_SECRET"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  resendApiKey: optional("RESEND_API_KEY"),
  resendFrom: optional("RESEND_FROM_EMAIL", "noreply@probekit.com"),
  corsOrigins: (optional("CORS_ORIGINS") || "https://probekit-mvp-326.netlify.app,http://localhost:3000").split(",")
};

// src/routes/research.ts
import { Hono } from "hono";
import { stream } from "hono/streaming";

// src/services/supabase.ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
function createClient() {
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceKey);
}

// src/services/grok.ts
var API_URL = "https://api.x.ai/v1/chat/completions";
async function callGrok(messages, signal) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.xaiApiKey}`
    },
    body: JSON.stringify({
      model: env.grokModel,
      messages,
      temperature: 0.3
    }),
    signal
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Grok API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}
async function* callGrokStream(messages, signal) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.xaiApiKey}`
    },
    body: JSON.stringify({
      model: env.grokModel,
      messages,
      temperature: 0.3,
      stream: true
    }),
    signal
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Grok API ${res.status}: ${body}`);
  }
  if (!res.body) throw new Error("Grok returned empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
var INTERPRET_PROMPT = `You are a business research assistant. Given a user's problem description, extract specific search queries for X/Twitter and Reddit.

Output JSON only \u2014 no markdown fences, no explanation:
{
  "topic_summary": "Brief summary of the research topic",
  "x_queries": ["query1 -is:retweet lang:en", "query2 -is:retweet lang:en"],
  "reddit_queries": [
    { "subreddit": "relevant_sub1", "keywords": ["keyword1", "keyword2"] },
    { "subreddit": "relevant_sub2", "keywords": ["keyword1"] }
  ]
}

Guidelines:
- x_queries: 2-4 queries. Always append -is:retweet. Add lang:en for English topics, lang:ko for Korean.
- reddit_queries: 2-4 subreddits with 1-3 keywords each. Pick subs where this topic is actively discussed.
- Focus on pain points, complaints, frustrations, wish-list items.`;
async function interpretProblem(problem, signal) {
  const content = await callGrok(
    [
      { role: "system", content: INTERPRET_PROMPT },
      { role: "user", content: problem }
    ],
    signal
  );
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw new Error("Failed to parse Grok search-query response as JSON");
  }
}
var REPORT_PROMPT = `You are a business research analyst producing concise, actionable reports.

Write a structured markdown report:

# {topic}

## Executive Summary
2-3 sentences on core findings.

## Key Pain Points
Specific problems people mention, with evidence quotes (> blockquote).

## Frequency & Severity
How often and how seriously people discuss this.

## Existing Alternatives
What solutions people currently use or mention.

## Gaps & Opportunities
Unmet needs and potential business opportunities.

Rules:
- Cite specific posts/tweets as evidence (> blockquotes).
- Be specific, not generic. Numbers over adjectives.
- If data is insufficient, say so honestly. Do not fabricate.
- Keep the report under 1500 words.
- Write in the same language as the user's original problem description.`;
function buildReportInput(topicSummary, problem, tweets, posts) {
  const tweetBlock = tweets.map(
    (t) => `@${t.author}: "${t.text}" (\u2764\uFE0F${t.metrics?.like_count ?? 0} \u{1F501}${t.metrics?.retweet_count ?? 0})`
  ).join("\n");
  const redditBlock = posts.map(
    (p) => `r/${p.subreddit} [score:${p.score}] "${p.title}" \u2014 ${p.selftext_preview}`
  ).join("\n");
  return `Original problem: ${problem}
Topic: ${topicSummary}

--- X/Twitter Data (${tweets.length} tweets) ---
${tweetBlock}

--- Reddit Data (${posts.length} posts) ---
${redditBlock}`;
}
async function* generateReportStream(topicSummary, problem, tweets, posts, signal) {
  yield* callGrokStream(
    [
      { role: "system", content: REPORT_PROMPT },
      {
        role: "user",
        content: buildReportInput(topicSummary, problem, tweets, posts)
      }
    ],
    signal
  );
}

// src/services/x-search.ts
var API_BASE = "https://api.twitter.com/2";
async function search(query, maxResults = 20) {
  if (!env.xBearerToken) return [];
  const params = new URLSearchParams({
    query,
    max_results: String(Math.max(10, Math.min(100, maxResults))),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username"
  });
  const res = await fetch(`${API_BASE}/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${env.xBearerToken}` }
  });
  if (!res.ok) {
    console.error(`X API error: ${res.status}`);
    return [];
  }
  const data = await res.json();
  if (!data.data) return [];
  const users = new Map(
    (data.includes?.users ?? []).map((u) => [u.id, u.username])
  );
  return data.data.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    author: users.get(tweet.author_id) || "unknown",
    created_at: tweet.created_at,
    metrics: tweet.public_metrics ?? {
      like_count: 0,
      retweet_count: 0,
      reply_count: 0
    }
  }));
}
async function searchMultiple(queries) {
  const results = await Promise.allSettled(
    queries.map(
      (q, i) => new Promise(
        (resolve) => setTimeout(
          () => search(q).then(resolve).catch(() => resolve([])),
          i * 1e3
        )
      )
    )
  );
  const tweets = results.filter(
    (r) => r.status === "fulfilled"
  ).flatMap((r) => r.value);
  const seen = /* @__PURE__ */ new Set();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

// src/services/reddit.ts
var USER_AGENT = "ProbeKit/1.0";
async function getOAuthToken() {
  if (!env.redditClientId || !env.redditClientSecret) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.redditClientId}:${env.redditClientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}
async function searchSubreddit(subreddit, keywords, limit = 15) {
  const token = await getOAuthToken();
  const query = keywords.join(" OR ");
  const baseUrl = token ? `https://oauth.reddit.com/r/${subreddit}/search` : `https://www.reddit.com/r/${subreddit}/search.json`;
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    t: "month",
    limit: String(limit),
    type: "link",
    sort: "relevance"
  });
  const headers = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}?${params}`, { headers });
  if (!res.ok) {
    console.error(`Reddit API error: ${res.status} for r/${subreddit}`);
    return [];
  }
  const data = await res.json();
  const children = data.data?.children ?? [];
  return children.filter((c) => c.data.author !== "[deleted]").map((c) => ({
    id: c.data.id,
    title: c.data.title,
    selftext_preview: (c.data.selftext || "").slice(0, 500),
    author: c.data.author,
    subreddit: c.data.subreddit,
    score: c.data.score,
    num_comments: c.data.num_comments,
    url: `https://reddit.com${c.data.permalink}`
  }));
}
async function searchMultiple2(queries) {
  const results = await Promise.allSettled(
    queries.map(
      (q, i) => new Promise(
        (resolve) => setTimeout(
          () => searchSubreddit(q.subreddit, q.keywords).then(resolve).catch(() => resolve([])),
          i * 500
        )
      )
    )
  );
  const posts = results.filter(
    (r) => r.status === "fulfilled"
  ).flatMap((r) => r.value);
  const seen = /* @__PURE__ */ new Set();
  return posts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).sort(
    (a, b) => b.score + b.num_comments * 2 - (a.score + a.num_comments * 2)
  );
}

// src/services/email.ts
function isEmailConfigured() {
  return !!env.resendApiKey;
}
async function sendReportEmail(params) {
  if (!env.resendApiKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.resendApiKey}`
    },
    body: JSON.stringify({
      from: env.resendFrom,
      to: params.to,
      subject: params.subject,
      html: markdownToHtml(params.reportMarkdown)
    })
  });
  if (!res.ok) {
    console.error(`Resend API error: ${res.status}`, await res.text());
    return false;
  }
  return true;
}
function markdownToHtml(md) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
  h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 24px; }
  blockquote { border-left: 3px solid #3b82f6; padding-left: 12px; color: #4b5563; margin: 12px 0; }
  p { line-height: 1.6; }
</style></head>
<body>
<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(md)}</pre>
<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb;">
<p style="font-size:12px;color:#9ca3af;">Generated by ProbeKit</p>
</body>
</html>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/routes/research.ts
var PIPELINE_TIMEOUT_MS = 12e4;
var research = new Hono();
research.post("/", async (c) => {
  const body = await c.req.json();
  const problem = body.problem?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!problem || problem.length < 5) {
    return c.json({ error: "Problem description too short (min 5 chars)" }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), PIPELINE_TIMEOUT_MS);
  return stream(
    c,
    async (s) => {
      const send = async (event) => {
        await s.write(JSON.stringify(event) + "\n");
      };
      s.onAbort(() => {
        ac.abort();
        clearTimeout(timeout);
      });
      try {
        const supabase = createClient();
        await send({ type: "status", message: "Checking access..." });
        const { count: ipCount } = await supabase.from("probekit_leads").select("*", { count: "exact", head: true }).eq("ip_address", ip).gte(
          "created_at",
          new Date(Date.now() - 864e5).toISOString()
        );
        if (ipCount && ipCount > 0) {
          await send({
            type: "error",
            message: "Daily limit reached. Please try again tomorrow."
          });
          return;
        }
        const { count: emailCount } = await supabase.from("probekit_leads").select("*", { count: "exact", head: true }).eq("email", email);
        if (emailCount && emailCount > 0) {
          await send({
            type: "error",
            message: "This email has already been used for a report."
          });
          return;
        }
        const leadId = crypto.randomUUID();
        await supabase.from("probekit_leads").insert({
          id: leadId,
          email,
          problem,
          ip_address: ip
        });
        await send({ type: "status", message: "Analyzing your problem..." });
        const queries = await interpretProblem(problem, ac.signal);
        await send({
          type: "status",
          message: `Researching: ${queries.topic_summary}`
        });
        await send({ type: "status", message: "Searching X and Reddit..." });
        const [tweets, posts] = await Promise.all([
          searchMultiple(queries.x_queries),
          searchMultiple2(queries.reddit_queries)
        ]);
        await send({
          type: "status",
          message: `Found ${tweets.length} tweets and ${posts.length} Reddit posts. Generating report...`
        });
        let fullReport = "";
        for await (const chunk of generateReportStream(
          queries.topic_summary,
          problem,
          tweets,
          posts,
          ac.signal
        )) {
          fullReport += chunk;
          await send({ type: "report_chunk", content: chunk });
        }
        await supabase.from("probekit_reports").insert({
          id: crypto.randomUUID(),
          lead_id: leadId,
          content: fullReport,
          search_data: {
            tweets_count: tweets.length,
            posts_count: posts.length
          }
        });
        if (isEmailConfigured()) {
          await sendReportEmail({
            to: email,
            subject: `Your ProbeKit Report: ${queries.topic_summary}`,
            reportMarkdown: fullReport
          });
        }
        await send({ type: "done" });
      } catch (err) {
        const message = ac.signal.aborted ? "Request timed out. Please try again." : err instanceof Error ? err.message : "Unknown error";
        await send({ type: "error", message });
      } finally {
        clearTimeout(timeout);
      }
    }
  );
});

// src/index.ts
var app = new Hono2();
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400
  })
);
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));
app.route("/api/v1/research", research);
serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`probekit-api listening on :${info.port}`);
});
var index_default = app;
export {
  index_default as default
};
