const OPENAI_BASE_URL = new URL("https://api.openai.com/v1/");
const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export class OpenAIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigurationError";
  }
}

function getOpenAIApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIConfigurationError("Define OPENAI_API_KEY en el entorno del servidor.");
  }
  return apiKey;
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export async function openAIFetch(
  path: string,
  init: RequestInit = {},
  timeoutMilliseconds = 30_000,
) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${getOpenAIApiKey()}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const organization = process.env.OPENAI_ORGANIZATION_ID?.trim();
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  if (organization) headers.set("OpenAI-Organization", organization);
  if (project) headers.set("OpenAI-Project", project);

  return fetch(new URL(path.replace(/^\/+/, ""), OPENAI_BASE_URL), {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
}
