import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("desktop package securely requests and forwards an OpenAI API key", async () => {
  const [packageJsonText, main, setup, preload] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("desktop/main.cjs", root), "utf8"),
    readFile(new URL("desktop/setup.html", root), "utf8"),
    readFile(new URL("desktop/setup-preload.cjs", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonText);

  assert.equal(packageJson.main, "desktop/main.cjs");
  assert.match(packageJson.scripts["desktop:dist"], /electron-builder/);
  assert.deepEqual(packageJson.build.extraResources.map((entry) => entry.to), ["webapp", "webapp/node_modules"]);
  assert.match(packageJson.scripts["desktop:dist:win"], /--win nsis --x64/);
  assert.match(main, /ELECTRON_RUN_AS_NODE/);
  assert.match(main, /OPENAI_API_KEY: apiKey/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /https:\/\/api\.openai\.com\/v1\/models/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(setup, /Clave API de OpenAI/);
  assert.match(setup, /almacén seguro del sistema/);
  assert.match(preload, /openai-key:submit/);
});

test("desktop assets exist", async () => {
  await access(new URL("desktop/assets/icon.png", root));
  await access(new URL("desktop/setup-preload.cjs", root));
});
