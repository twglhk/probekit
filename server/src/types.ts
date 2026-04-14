export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "report_chunk"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SearchQueries {
  topic_summary: string;
  x_queries: string[];
  reddit_queries: Array<{
    subreddit: string;
    keywords: string[];
  }>;
}

export interface Tweet {
  id: string;
  text: string;
  author: string;
  created_at: string;
  metrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

export interface XApiTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: Record<string, number>;
}

export interface XApiUser {
  id: string;
  username: string;
}

export interface XApiResponse {
  data?: XApiTweet[];
  includes?: { users?: XApiUser[] };
}

export interface RedditPost {
  id: string;
  title: string;
  selftext_preview: string;
  author: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
}

export interface ResearchRequest {
  problem: string;
  email: string;
}
