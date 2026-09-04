import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenAIModel,
  OpenAIConfigurationError,
  openAIFetch,
} from "../app/lib/openai.ts";

test("sends the API key only to the official OpenAI HTTPS endpoint", async (context) => {
  let receivedAuthorization = "";
  let receivedOrganization = "";
  let receivedProject = "";
  let receivedUrl = "";
  let receivedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    receivedUrl = String(input);
    const headers = new Headers(init?.headers);
    receivedAuthorization = headers.get("Authorization") || "";
    receivedOrganization = headers.get("OpenAI-Organization") || "";
    receivedProject = headers.get("OpenAI-Project") || "";
    receivedBody = String(init?.body || "");
    return Response.json({ output: [] });
  };

  process.env.OPENAI_API_KEY = "test-secret-key-that-is-long-enough";
  process.env.OPENAI_ORGANIZATION_ID = "org_test";
  process.env.OPENAI_PROJECT_ID = "proj_test";
  context.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_ORGANIZATION_ID;
    delete process.env.OPENAI_PROJECT_ID;
  });

  const response = await openAIFetch("responses", {
    method: "POST",
    body: JSON.stringify({ input: "prueba" }),
  });

  assert.equal(response.status, 200);
  assert.equal(receivedUrl, "https://api.openai.com/v1/responses");
  assert.equal(receivedAuthorization, "Bearer test-secret-key-that-is-long-enough");
  assert.equal(receivedOrganization, "org_test");
  assert.equal(receivedProject, "proj_test");
  assert.doesNotMatch(receivedBody, /test-secret-key/);
});

test("requires OPENAI_API_KEY", async (context) => {
  delete process.env.OPENAI_API_KEY;
  context.after(() => delete process.env.OPENAI_API_KEY);

  await assert.rejects(
    openAIFetch("models/gpt-5.6-terra"),
    (error) => error instanceof OpenAIConfigurationError && /OPENAI_API_KEY/.test(error.message),
  );
});

test("uses a configurable model with a stable default", (context) => {
  delete process.env.OPENAI_MODEL;
  assert.equal(getOpenAIModel(), "gpt-5.6-terra");
  process.env.OPENAI_MODEL = "custom-model";
  context.after(() => delete process.env.OPENAI_MODEL);
  assert.equal(getOpenAIModel(), "custom-model");
});
