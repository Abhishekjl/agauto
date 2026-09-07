import Fastify from "fastify";
import cors from "@fastify/cors";
import type {
  ApiError,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractProfileRequest,
  StartSessionRequest,
  StepSessionRequest,
} from "@agauto/shared";
import { env } from "./env";
import { chat, embed } from "./llm";
import { startSession, stepSession } from "./agent";
import { extractProfile } from "./profile";

const app = Fastify({ logger: true });

// Dev CORS: reflect the requesting origin so the chrome-extension:// side panel
// can call us. Tighten this before shipping.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: ChatRequest }>("/api/chat", async (req, reply) => {
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    reply.code(400);
    return { error: "prompt (string) is required" } satisfies ApiError;
  }

  try {
    const result = await chat(prompt);
    return result satisfies ChatResponse;
  } catch (err) {
    req.log.error(err);
    reply.code(500);
    const message = err instanceof Error ? err.message : "LLM call failed";
    return { error: message } satisfies ApiError;
  }
});

app.post<{ Body: EmbedRequest }>("/api/embed", async (req, reply) => {
  const texts = req.body?.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    reply.code(400);
    return { error: "texts[] required" } satisfies ApiError;
  }
  try {
    return { vectors: await embed(texts) } satisfies EmbedResponse;
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: e instanceof Error ? e.message : "embed failed" } satisfies ApiError;
  }
});

app.post<{ Body: ExtractProfileRequest }>("/api/profile/extract", async (req, reply) => {
  const { images, text } = req.body ?? {};
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!hasImages && !text?.trim()) {
    reply.code(400);
    return { error: "images[] or text required" } satisfies ApiError;
  }
  try {
    return await extractProfile(req.body);
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: e instanceof Error ? e.message : "extract failed" } satisfies ApiError;
  }
});

app.post<{ Body: StartSessionRequest }>("/api/session/start", async (req, reply) => {
  const { goal, profile, pageState } = req.body ?? {};
  if (!profile?.raw || !pageState) {
    reply.code(400);
    return { error: "profile.raw and pageState are required" } satisfies ApiError;
  }
  try {
    return await startSession({
      goal: goal || "Fill out this form using my profile.",
      profile,
      pageState,
      hasDocument: req.body?.hasDocument,
      jobDescription: req.body?.jobDescription,
    });
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: e instanceof Error ? e.message : "start failed" } satisfies ApiError;
  }
});

app.post<{ Body: StepSessionRequest }>("/api/session/step", async (req, reply) => {
  const body = req.body;
  if (!body?.sessionId) {
    reply.code(400);
    return { error: "sessionId is required" } satisfies ApiError;
  }
  try {
    return await stepSession(body);
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: e instanceof Error ? e.message : "step failed" } satisfies ApiError;
  }
});

app
  .listen({ port: env.PORT, host: "127.0.0.1" })
  .then((addr) => app.log.info(`AgAuto backend listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
