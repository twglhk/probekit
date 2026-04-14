import { env } from "../env.js";
import type { GrokMessage, SearchQueries, Tweet, RedditPost } from "../types.js";

const API_URL = "https://api.x.ai/v1/chat/completions";

async function callGrok(
  messages: GrokMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.xaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.grokModel,
      messages,
      temperature: 0.3,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Grok API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

export async function* callGrokStream(
  messages: GrokMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.xaiApiKey}`,
    },
    body: JSON.stringify({
      model: env.grokModel,
      messages,
      temperature: 0.3,
      stream: true,
    }),
    signal,
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
          const parsed = JSON.parse(payload) as {
            choices: Array<{ delta: { content?: string } }>;
          };
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

const INTERPRET_PROMPT = `You are a business research assistant. Given a user's problem description, extract specific search queries for X/Twitter and Reddit.

Output JSON only — no markdown fences, no explanation:
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

export async function interpretProblem(
  problem: string,
  signal?: AbortSignal,
): Promise<SearchQueries> {
  const content = await callGrok(
    [
      { role: "system", content: INTERPRET_PROMPT },
      { role: "user", content: problem },
    ],
    signal,
  );

  try {
    return JSON.parse(content) as SearchQueries;
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]) as SearchQueries;
    throw new Error("Failed to parse Grok search-query response as JSON");
  }
}

const REPORT_PROMPT = `You are a business research analyst producing concise, actionable reports.

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

function buildReportInput(
  topicSummary: string,
  problem: string,
  tweets: Tweet[],
  posts: RedditPost[],
): string {
  const tweetBlock = tweets
    .map(
      (t) =>
        `@${t.author}: "${t.text}" (❤️${t.metrics?.like_count ?? 0} 🔁${t.metrics?.retweet_count ?? 0})`,
    )
    .join("\n");

  const redditBlock = posts
    .map(
      (p) =>
        `r/${p.subreddit} [score:${p.score}] "${p.title}" — ${p.selftext_preview}`,
    )
    .join("\n");

  return `Original problem: ${problem}
Topic: ${topicSummary}

--- X/Twitter Data (${tweets.length} tweets) ---
${tweetBlock}

--- Reddit Data (${posts.length} posts) ---
${redditBlock}`;
}

export async function* generateReportStream(
  topicSummary: string,
  problem: string,
  tweets: Tweet[],
  posts: RedditPost[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  yield* callGrokStream(
    [
      { role: "system", content: REPORT_PROMPT },
      {
        role: "user",
        content: buildReportInput(topicSummary, problem, tweets, posts),
      },
    ],
    signal,
  );
}
