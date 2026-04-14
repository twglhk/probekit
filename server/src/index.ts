import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env.js";
import { research } from "./routes/research.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));
app.route("/api/v1/research", research);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`probekit-api listening on :${info.port}`);
});

export default app;
