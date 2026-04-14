import { env } from "../env.js";
import type { RedditPost } from "../types.js";

const USER_AGENT = "ProbeKit/1.0";

interface RedditTokenResponse {
  access_token: string;
}

interface RedditChild {
  data: {
    id: string;
    title: string;
    selftext: string;
    author: string;
    subreddit: string;
    score: number;
    num_comments: number;
    permalink: string;
  };
}

interface RedditSearchResponse {
  data?: { children?: RedditChild[] };
}

async function getOAuthToken(): Promise<string | null> {
  if (!env.redditClientId || !env.redditClientSecret) return null;

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.redditClientId}:${env.redditClientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) return null;
  const data = (await res.json()) as RedditTokenResponse;
  return data.access_token;
}

async function searchSubreddit(
  subreddit: string,
  keywords: string[],
  limit = 15,
): Promise<RedditPost[]> {
  const token = await getOAuthToken();
  const query = keywords.join(" OR ");

  const baseUrl = token
    ? `https://oauth.reddit.com/r/${subreddit}/search`
    : `https://www.reddit.com/r/${subreddit}/search.json`;

  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    t: "month",
    limit: String(limit),
    type: "link",
    sort: "relevance",
  });

  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}?${params}`, { headers });
  if (!res.ok) {
    console.error(`Reddit API error: ${res.status} for r/${subreddit}`);
    return [];
  }

  const data = (await res.json()) as RedditSearchResponse;
  const children = data.data?.children ?? [];

  return children
    .filter((c) => c.data.author !== "[deleted]")
    .map((c) => ({
      id: c.data.id,
      title: c.data.title,
      selftext_preview: (c.data.selftext || "").slice(0, 500),
      author: c.data.author,
      subreddit: c.data.subreddit,
      score: c.data.score,
      num_comments: c.data.num_comments,
      url: `https://reddit.com${c.data.permalink}`,
    }));
}

export async function searchMultiple(
  queries: Array<{ subreddit: string; keywords: string[] }>,
): Promise<RedditPost[]> {
  const results = await Promise.allSettled(
    queries.map(
      (q, i) =>
        new Promise<RedditPost[]>((resolve) =>
          setTimeout(
            () =>
              searchSubreddit(q.subreddit, q.keywords)
                .then(resolve)
                .catch(() => resolve([])),
            i * 500,
          ),
        ),
    ),
  );

  const posts = results
    .filter(
      (r): r is PromiseFulfilledResult<RedditPost[]> =>
        r.status === "fulfilled",
    )
    .flatMap((r) => r.value);

  const seen = new Set<string>();
  return posts
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .sort(
      (a, b) => b.score + b.num_comments * 2 - (a.score + a.num_comments * 2),
    );
}
