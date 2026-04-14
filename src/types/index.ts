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

export interface StreamEvent {
  type: "status" | "report" | "report_chunk" | "error" | "done";
  message?: string;
  content?: string;
}
