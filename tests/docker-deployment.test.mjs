import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("runs only the application container and keeps it behind Nginx", async () => {
  const [compose, nginxConfig, exampleEnvironment] = await Promise.all([
    readFile(new URL("compose.yaml", root), "utf8"),
    readFile(new URL("deploy/nginx/aichef.conf", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(compose, /OPENAI_API_KEY/);
  assert.match(compose, /OPENAI_MODEL/);
  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000/);
  assert.doesNotMatch(compose, /11434|caddy:/);
  assert.match(exampleEnvironment, /OPENAI_API_KEY=/);
  assert.match(exampleEnvironment, /OPENAI_MODEL=gpt-5\.6-terra/);
  assert.match(nginxConfig, /server_name circularchef\.effichef\.es/);
  assert.match(nginxConfig, /proxy_pass http:\/\/127\.0\.0\.1:3100/);
  assert.match(nginxConfig, /proxy_read_timeout 300s/);
  assert.doesNotMatch(nginxConfig, /11434/);
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
  const [script, metadata] = await Promise.all([readFile(scriptUrl, "utf8"), stat(scriptUrl)]);

  assert.match(script, /git pull --ff-only origin main/);
  assert.match(script, /docker compose up -d --build --remove-orphans/);
  assert.notEqual(metadata.mode & 0o111, 0);
});
