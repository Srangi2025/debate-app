import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const base = process.env.AI_JUDGE_URL || "http://127.0.0.1:8001";
try {
  const response = await fetch(new URL("/health", base), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error();
  const health = await response.json();
  console.log("AI service reachable; configured judge:", health.model);
  console.log("Judge version:", health.judge_version);
  if (health.live_version) console.log("Live evidence version:", health.live_version);
  const speech = await fetch(new URL("/transcription/health", base), { signal: AbortSignal.timeout(5000) });
  if (!speech.ok) throw new Error();
  const status = await speech.json();
  console.log("Speech model:", status.model, status.ready ? "loaded" : "loads on first audio request");
  console.log("These health endpoints do not verify Ollama inference. Run the documented model evaluation for that check.");
} catch {
  console.error("AI service health check failed. For local development, start Ollama and run npm run ai:dev.");
  process.exitCode = 1;
}
