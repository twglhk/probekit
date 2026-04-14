import type { SearchQueries } from "@/types";

const API_URL = "https://api.x.ai/v1/chat/completions";

async function callGrok(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROK_MODEL || "grok-3-fast",
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Grok API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

export async function interpretProblem(
  problem: string,
): Promise<SearchQueries> {
  const content = await callGrok([
    {
      role: "system",
      content: `You are a business research assistant. Given a user's problem description, extract specific search queries for X/Twitter and Reddit.

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
- Focus on pain points, complaints, frustrations, wish-list items.`,
    },
    { role: "user", content: problem },
  ]);

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw new Error("Failed to parse Grok search-query response as JSON");
  }
}

export async function generateReport(
  topicSummary: string,
  problem: string,
  tweets: Array<{ text: string; author: string; metrics?: Record<string, number> }>,
  posts: Array<{
    title: string;
    selftext_preview: string;
    subreddit: string;
    score: number;
  }>,
): Promise<string> {
  return callGrok([
    {
      role: "system",
      content: `You are a business research analyst producing concise, actionable reports.

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
- Write in the same language as the user's original problem description.`,
    },
    {
      role: "user",
      content: `Original problem: ${problem}
Topic: ${topicSummary}

--- X/Twitter Data (${tweets.length} tweets) ---
${tweets.map((t) => `@${t.author}: "${t.text}" (❤️${t.metrics?.like_count ?? 0} 🔁${t.metrics?.retweet_count ?? 0})`).join("\n")}

--- Reddit Data (${posts.length} posts) ---
${posts.map((p) => `r/${p.subreddit} [score:${p.score}] "${p.title}" — ${p.selftext_preview}`).join("\n")}`,
    },
  ]);
}
