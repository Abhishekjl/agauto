import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 8787),
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  // Embeddings may live on a different endpoint/model than chat.
  EMBED_BASE_URL:
    process.env.EMBED_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  EMBED_API_KEY: process.env.EMBED_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  EMBED_MODEL: process.env.EMBED_MODEL ?? "bge-small",
};

if (!env.OPENAI_API_KEY) {
  console.warn(
    "[agauto] OPENAI_API_KEY is not set. Copy backend/.env.example to backend/.env and fill it in."
  );
}
