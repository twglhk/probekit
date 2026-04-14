import { createServerClient } from "@/lib/supabase";
import { interpretProblem, generateReport } from "@/lib/grok";
import { searchMultiple as searchTweets } from "@/lib/x-api";
import { searchMultiple as searchReddit } from "@/lib/reddit-api";
import type { StreamEvent } from "@/types";

export const runtime = "edge";

function stream(
  handler: (send: (event: StreamEvent) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        await handler(send);
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { problem, email } = body as { problem: string; email: string };

  if (!problem || problem.trim().length < 5) {
    return Response.json(
      { error: "Problem description too short (min 5 chars)" },
      { status: 400 },
    );
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Invalid email format" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  return stream(async (send) => {
    const supabase = createServerClient();

    send({ type: "status", message: "Checking access..." });

    const { count: ipCount } = await supabase
      .from("probekit_leads")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());

    if (ipCount && ipCount > 0) {
      send({
        type: "error",
        message: "Daily limit reached. Please try again tomorrow.",
      });
      return;
    }

    const { count: emailCount } = await supabase
      .from("probekit_leads")
      .select("*", { count: "exact", head: true })
      .eq("email", email.toLowerCase());

    if (emailCount && emailCount > 0) {
      send({
        type: "error",
        message: "This email has already been used for a report.",
      });
      return;
    }

    const leadId = crypto.randomUUID();
    await supabase.from("probekit_leads").insert({
      id: leadId,
      email: email.toLowerCase(),
      problem: problem.trim(),
      ip_address: ip,
    });

    // Step 1: Interpret problem → search queries
    send({ type: "status", message: "Analyzing your problem..." });
    const queries = await interpretProblem(problem);
    send({
      type: "status",
      message: `Researching: ${queries.topic_summary}`,
    });

    // Step 2: Parallel search — X + Reddit
    send({ type: "status", message: "Searching X and Reddit..." });
    const [tweets, posts] = await Promise.all([
      searchTweets(queries.x_queries),
      searchReddit(queries.reddit_queries),
    ]);

    send({
      type: "status",
      message: `Found ${tweets.length} tweets and ${posts.length} Reddit posts. Generating report...`,
    });

    // Step 3: Synthesize report
    const report = await generateReport(
      queries.topic_summary,
      problem,
      tweets,
      posts,
    );

    await supabase.from("probekit_reports").insert({
      id: crypto.randomUUID(),
      lead_id: leadId,
      content: report,
      search_data: {
        tweets_count: tweets.length,
        posts_count: posts.length,
      },
    });

    send({ type: "report", content: report });
    send({ type: "done" });
  });
}
