import { env } from "../env.js";
import type { Tweet, XApiResponse } from "../types.js";

const API_BASE = "https://api.twitter.com/2";

async function search(query: string, maxResults = 20): Promise<Tweet[]> {
  if (!env.xBearerToken) return [];

  const params = new URLSearchParams({
    query,
    max_results: String(Math.max(10, Math.min(100, maxResults))),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username",
  });

  const res = await fetch(`${API_BASE}/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${env.xBearerToken}` },
  });

  if (!res.ok) {
    console.error(`X API error: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as XApiResponse;
  if (!data.data) return [];

  const users = new Map(
    (data.includes?.users ?? []).map((u) => [u.id, u.username]),
  );

  return data.data.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    author: users.get(tweet.author_id) || "unknown",
    created_at: tweet.created_at,
    metrics: (tweet.public_metrics as Tweet["metrics"]) ?? {
      like_count: 0,
      retweet_count: 0,
      reply_count: 0,
    },
  }));
}

export async function searchMultiple(queries: string[]): Promise<Tweet[]> {
  const results = await Promise.allSettled(
    queries.map(
      (q, i) =>
        new Promise<Tweet[]>((resolve) =>
          setTimeout(
            () => search(q).then(resolve).catch(() => resolve([])),
            i * 1000,
          ),
        ),
    ),
  );

  const tweets = results
    .filter(
      (r): r is PromiseFulfilledResult<Tweet[]> => r.status === "fulfilled",
    )
    .flatMap((r) => r.value);

  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}
