"use client";

import { useState, useCallback, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamEvent } from "@/types";

type Phase = "idle" | "loading" | "done" | "error";

export default function ResearchSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState("");
  const [email, setEmail] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [report, setReport] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!problem.trim() || !email.trim()) return;

      setPhase("loading");
      setStatusMsg("Starting research...");
      setReport("");
      setErrorMsg("");

      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem: problem.trim(), email: email.trim() }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `Request failed (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const event: StreamEvent = JSON.parse(line);

            switch (event.type) {
              case "status":
                setStatusMsg(event.message || "");
                break;
              case "report":
                setReport(event.content || "");
                setPhase("done");
                break;
              case "error":
                setErrorMsg(event.message || "Something went wrong");
                setPhase("error");
                break;
              case "done":
                break;
            }
          }
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
        setPhase("error");
      }
    },
    [problem, email],
  );

  return (
    <section id="research" className="w-full max-w-2xl mx-auto px-4">
      {phase === "idle" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label
              htmlFor="problem"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              What problem are you trying to solve?
            </label>
            <textarea
              id="problem"
              rows={4}
              required
              minLength={5}
              placeholder="e.g. I'm thinking about starting a café but I'm not sure if it's a good idea..."
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={problem.trim().length < 5 || !email.trim()}
            className="w-full rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Get Free Research Report
          </button>

          <p className="text-xs text-gray-400 text-center">
            One free report per email. Takes about 30-60 seconds.
          </p>
        </form>
      )}

      {phase === "loading" && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <p className="text-gray-600 text-center animate-pulse">{statusMsg}</p>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-6">
          <article className="prose prose-gray max-w-none prose-headings:font-semibold prose-blockquote:border-l-blue-500 prose-blockquote:text-gray-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {report}
            </ReactMarkdown>
          </article>

          <div className="border-t pt-6 text-center">
            <p className="text-sm text-gray-500">
              Want deeper analysis for your business?
            </p>
            <a
              href="#"
              className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Learn more about ProbeKit →
            </a>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm w-full text-center">
            {errorMsg}
          </div>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← Try again
          </button>
        </div>
      )}
    </section>
  );
}
