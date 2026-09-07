import type {
  AgentStep,
  ExtractProfileRequest,
  ExtractProfileResponse,
  StartSessionRequest,
  StepSessionRequest,
} from "@agauto/shared";

const BACKEND = "http://127.0.0.1:8787";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error ?? `HTTP ${res.status} — is the backend running?`
    );
  }
  return data as T;
}

export function startAgent(body: StartSessionRequest): Promise<AgentStep> {
  return post("/api/session/start", body);
}

export function stepAgent(body: StepSessionRequest): Promise<AgentStep> {
  return post("/api/session/step", body);
}

export function extractDocument(
  body: ExtractProfileRequest
): Promise<ExtractProfileResponse> {
  return post("/api/profile/extract", body);
}
