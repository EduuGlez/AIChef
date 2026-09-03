const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";

export class OllamaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaConfigurationError";
  }
}

type OllamaConfig = {
  baseUrl: URL;
  apiKey?: string;
  model: string;
};

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isTrustedInternalHost(hostname: string) {
  const trustedHosts = process.env.OLLAMA_TRUSTED_HOSTS
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) ?? [];

  return isLoopback(hostname) || trustedHosts.includes(hostname.toLowerCase());
}

function getOllamaConfig(): OllamaConfig {
  const rawBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  let baseUrl: URL;

  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new OllamaConfigurationError("OLLAMA_BASE_URL no es una URL válida.");
  }

  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new OllamaConfigurationError("OLLAMA_BASE_URL debe utilizar HTTP o HTTPS.");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new OllamaConfigurationError(
      "No incluyas credenciales en OLLAMA_BASE_URL; utiliza OLLAMA_API_KEY.",
    );
  }

  const trustedInternalHost = isTrustedInternalHost(baseUrl.hostname);
  const remoteHttpAllowed = process.env.OLLAMA_ALLOW_INSECURE_HTTP === "true";
  if (baseUrl.protocol === "http:" && !trustedInternalHost && !remoteHttpAllowed) {
    throw new OllamaConfigurationError("El Ollama remoto debe estar protegido con HTTPS.");
  }

  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (!trustedInternalHost && !apiKey) {
    throw new OllamaConfigurationError(
      "Define OLLAMA_API_KEY para conectar con un Ollama remoto.",
    );
  }

  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return {
    baseUrl,
    apiKey,
    model: process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
  };
}

export function getOllamaModel() {
  return getOllamaConfig().model;
}

export async function ollamaFetch(
  path: string,
  init: RequestInit = {},
  timeoutMilliseconds = 10_000,
) {
  const config = getOllamaConfig();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (config.apiKey) headers.set("Authorization", `Bearer ${config.apiKey}`);

  return fetch(new URL(path.replace(/^\/+/, ""), config.baseUrl), {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
}
