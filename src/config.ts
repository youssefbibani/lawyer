/**
 * Runtime configuration. Only *public endpoints* are read here — never API keys.
 * Model and speech credentials must live on the server behind these endpoints.
 */
const env = import.meta.env;

export const config = {
  /** Base URL of a backend implementing POST /assistant/chat (NDJSON stream). Empty = demo engine. */
  assistantApiUrl: (env.VITE_ASSISTANT_API_URL as string | undefined)?.replace(/\/$/, "") ?? "",
  /** Backend endpoint accepting POST multipart audio and returning { text }. Empty = not configured. */
  speechApiUrl: (env.VITE_STT_API_URL as string | undefined) ?? "",
  /** BCP-47 tag for browser speech recognition. Tunisian Arabic where supported. */
  speechLanguage: (env.VITE_SPEECH_LANG as string | undefined) ?? "ar-TN",
};

export const isDemoMode = !config.assistantApiUrl;
