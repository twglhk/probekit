import { Hono } from "hono";
import { stream } from "hono/streaming";
import { createClient } from "../services/supabase.js";
import { interpretProblem, generateReportStream } from "../services/grok.js";
import { searchMultiple as searchTweets } from "../services/x-search.js";
import { searchMultiple as searchReddit } from "../services/reddit.js";
import { sendReportEmail, isEmailConfigured } from "../services/email.js";
import type { StreamEvent } from "../types.js";

const PIPELINE_TIMEOUT_MS = 120_000;

export const research = new Hono();

research.post("/", async (c) => {
  const body = await c.req.json<{ problem?: string; email?: string }>();
  const problem = body.problem?.trim();
  const email = body.email?.trim().toLowerCase();

  if (!problem || problem.length < 5) {
    return c.json({ error: "Problem description too short (min 5 chars)" }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), PIPELINE_TIMEOUT_MS);

  return stream(
    c,
    async (s) => {
      const send = async (event: StreamEvent) => {
        await s.write(JSON.stringify(event) + "\n");
      };

      s.onAbort(() => {
        ac.abort();
        clearTimeout(timeout);
      });

      try {
        const supabase = createClient();

        await send({ type: "status", message: "Checking access..." });

        const { count: ipCount } = await supabase
          .from("probekit_leads")
          .select("*", { count: "exact", head: true })
          .eq("ip_address", ip)
          .gte(
            "created_at",
            new Date(Date.now() - 86_400_000).toISOString(),
          );

        if (ipCount && ipCount > 0) {
          await send({
            type: "error",
            message: "Daily limit reached. Please try again tomorrow.",
          });
          return;
        }

        const { count: emailCount } = await supabase
          .from("probekit_leads")
          .select("*", { count: "exact", head: true })
          .eq("email", email);

        if (emailCount && emailCount > 0) {
          await send({
            type: "error",
            message: "This email has already been used for a report.",
          });
          return;
        }

        const leadId = crypto.randomUUID();
        await supabase.from("probekit_leads").insert({
          id: leadId,
          email,
          problem,
          ip_address: ip,
        });

        await send({ type: "status", message: "Analyzing your problem..." });
        const queries = await interpretProblem(problem, ac.signal);
        await send({
          type: "status",
          message: `Researching: ${queries.topic_summary}`,
        });

        await send({ type: "status", message: "Searching X and Reddit..." });
        const [tweets, posts] = await Promise.all([
          searchTweets(queries.x_queries),
          searchReddit(queries.reddit_queries),
        ]);

        await send({
          type: "status",
          message: `Found ${tweets.length} tweets and ${posts.length} Reddit posts. Generating report...`,
        });

        let fullReport = "";
        for await (const chunk of generateReportStream(
          queries.topic_summary,
          problem,
          tweets,
          posts,
          ac.signal,
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
            posts_count: posts.length,
          },
        });

        if (isEmailConfigured()) {
          await sendReportEmail({
            to: email,
            subject: `Your ProbeKit Report: ${queries.topic_summary}`,
            reportMarkdown: fullReport,
          });
        }

        await send({ type: "done" });
      } catch (err) {
        const message = ac.signal.aborted
          ? "Request timed out. Please try again."
          : err instanceof Error
            ? err.message
            : "Unknown error";
        await send({ type: "error", message });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
});
