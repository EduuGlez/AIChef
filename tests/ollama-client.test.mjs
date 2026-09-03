import assert from "node:assert/strict";
import test from "node:test";

import {
  OllamaConfigurationError,
  ollamaFetch,
} from "../app/lib/ollama.ts";

test("sends the server token without exposing it in the request body", async (context) => {
  let receivedAuthorization = "";
  let receivedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedAuthorization = new Headers(init?.headers).get("Authorization") || "";
    return Response.json({ models: [] });
  };

  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_API_KEY = "test-secret";
  context.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
  });

  const response = await ollamaFetch("api/tags");
  assert.equal(response.status, 200);
  assert.equal(receivedAuthorization, "Bearer test-secret");
  assert.equal(receivedUrl, "http://127.0.0.1:11434/api/tags");
});

test("rejects an unencrypted remote Ollama URL", async (context) => {
  process.env.OLLAMA_BASE_URL = "http://ollama.example.com";
  process.env.OLLAMA_API_KEY = "test-secret";
  context.after(() => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
  });

  await assert.rejects(
    ollamaFetch("api/tags"),
    (error) => error instanceof OllamaConfigurationError && /HTTPS/.test(error.message),
  );
});

test("requires a token for a remote Ollama URL", async (context) => {
  process.env.OLLAMA_BASE_URL = "https://ollama.example.com";
  delete process.env.OLLAMA_API_KEY;
  context.after(() => delete process.env.OLLAMA_BASE_URL);

  await assert.rejects(
    ollamaFetch("api/tags"),
    (error) => error instanceof OllamaConfigurationError && /OLLAMA_API_KEY/.test(error.message),
  );
});

test("allows an explicitly trusted Ollama host on the private Docker network", async (context) => {
  let receivedAuthorization = "not-called";
  let receivedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedAuthorization = new Headers(init?.headers).get("Authorization") || "";
    return Response.json({ models: [] });
  };

  process.env.OLLAMA_BASE_URL = "http://ollama:11434";
  process.env.OLLAMA_TRUSTED_HOSTS = "ollama";
  delete process.env.OLLAMA_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_TRUSTED_HOSTS;
  });

  const response = await ollamaFetch("api/tags");
  assert.equal(response.status, 200);
  assert.equal(receivedAuthorization, "");
  assert.equal(receivedUrl, "http://ollama:11434/api/tags");
});
