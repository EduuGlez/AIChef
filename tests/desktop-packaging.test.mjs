import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("desktop package bundles the web app and Ollama", async () => {
  const [packageJsonText, main, setup, prepare] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("desktop/main.cjs", root), "utf8"),
    readFile(new URL("desktop/setup.html", root), "utf8"),
    readFile(new URL("scripts/prepare-ollama.mjs", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonText);

  assert.equal(packageJson.main, "desktop/main.cjs");
  assert.match(packageJson.scripts["desktop:dist"], /electron-builder/);
  assert.deepEqual(
    packageJson.build.extraResources.map((entry) => entry.to),
    ["webapp", "webapp/node_modules", "THIRD_PARTY_NOTICES.md"],
  );
  assert.equal(packageJson.build.mac.extraResources[0].from, ".desktop-vendor/ollama-darwin");
  assert.equal(packageJson.build.win.extraResources[0].from, ".desktop-vendor/ollama-win32-x64");
  assert.match(packageJson.scripts["desktop:dist:win"], /--win nsis --x64/);
  assert.match(main, /ELECTRON_RUN_AS_NODE/);
  assert.match(main, /OLLAMA_NO_CLOUD/);
  assert.match(main, /llama3\.2:3b/);
  assert.match(main, /\/api\/pull/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(setup, /primer inicio se descargará el modelo local/);
  assert.match(prepare, /Ollama-darwin\.zip/);
  assert.match(prepare, /ollama-windows-amd64\.zip/);
  assert.match(prepare, /WINDOWS_OLLAMA_SHA256/);
});

test("desktop assets exist", async () => {
  await access(new URL("desktop/assets/icon.png", root));
});
