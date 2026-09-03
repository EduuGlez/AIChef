import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps Ollama private and initializes the configured model", async () => {
  const [compose, caddyfile] = await Promise.all([
    readFile(new URL("compose.yaml", root), "utf8"),
    readFile(new URL("deploy/docker/Caddyfile", root), "utf8"),
  ]);

  assert.match(compose, /OLLAMA_BASE_URL: http:\/\/ollama:11434/);
  assert.match(compose, /OLLAMA_TRUSTED_HOSTS: ollama/);
  assert.match(compose, /ollama pull "\$\$\{OLLAMA_MODEL\}"/);
  assert.doesNotMatch(compose, /11434:11434/);
  assert.doesNotMatch(compose, /3000:3000/);
  assert.match(caddyfile, /reverse_proxy app:3000/);
  assert.doesNotMatch(caddyfile, /ollama:11434/);
});

test("builds a non-root standalone Next.js image", async () => {
  const [dockerfile, nextConfig] = await Promise.all([
    readFile(new URL("Dockerfile", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
  ]);

  assert.match(nextConfig, /output: "standalone"/);
  assert.match(dockerfile, /FROM node:22-alpine AS runner/);
  assert.match(dockerfile, /USER nextjs/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
});

test("provides an executable production deployment script", async () => {
  const scriptUrl = new URL("scripts/deploy.sh", root);
  const [script, metadata] = await Promise.all([
    readFile(scriptUrl, "utf8"),
    stat(scriptUrl),
  ]);

  assert.match(script, /git pull --ff-only origin main/);
  assert.match(script, /docker compose up -d --build --remove-orphans/);
  assert.notEqual(metadata.mode & 0o111, 0);
});
