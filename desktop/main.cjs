const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFile, access, mkdir, readFile, writeFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

let setupWindow;
let mainWindow;
let webProcess;
let pendingApiKey;
let setupState = { text: "Preparando la aplicación…", percent: 4 };

function resourcePath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(root, ...parts);
}

function webAppPath() {
  return app.isPackaged
    ? resourcePath("webapp")
    : path.join(__dirname, "..", "dist", "standalone");
}

function credentialPath() {
  return path.join(app.getPath("userData"), "openai-api-key.bin");
}

async function log(message) {
  const logDirectory = app.getPath("logs");
  await mkdir(logDirectory, { recursive: true });
  await appendFile(
    path.join(logDirectory, "circular-chef.log"),
    `${new Date().toISOString()} ${message}\n`,
    "utf8",
  );
}

function captureProcessOutput(child, label) {
  child.stdout?.on("data", (chunk) => void log(`[${label}] ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", (chunk) => void log(`[${label}] ${String(chunk).trimEnd()}`));
  child.on("error", (error) => void log(`[${label}] ERROR ${error.stack || error.message}`));
  child.on("exit", (code, signal) => void log(`[${label}] EXIT code=${code} signal=${signal}`));
}

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

async function loadApiKey() {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  if (!safeStorage.isEncryptionAvailable()) return "";

  try {
    const encrypted = await readFile(credentialPath());
    return safeStorage.decryptString(encrypted).trim();
  } catch {
    return "";
  }
}

async function saveApiKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(credentialPath(), safeStorage.encryptString(apiKey), { mode: 0o600 });
  return true;
}

async function validateApiKey(apiKey) {
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const response = await fetchWithTimeout(
    `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } },
    15_000,
  );

  if (!response.ok) {
    if (response.status === 401) throw new Error("La clave API no es válida.");
    if (response.status === 403) throw new Error("La clave no tiene acceso al modelo configurado.");
    throw new Error(`OpenAI respondió con HTTP ${response.status}.`);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForWebApp(url, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, {}, 5000);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`La interfaz no pudo iniciarse: ${lastError?.message || "tiempo agotado"}`);
}

async function startWebApp(apiKey) {
  if (webProcess) return webProcess.url;

  const appDirectory = webAppPath();
  const entry = path.join(appDirectory, "server.js");
  await access(entry);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  updateSetup("Iniciando Circular Chef…", 75);
  webProcess = spawn(process.execPath, [entry], {
    cwd: appDirectory,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      PORT: String(port),
      OPENAI_API_KEY: apiKey,
      OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  webProcess.url = url;
  captureProcessOutput(webProcess, "web");
  await waitForWebApp(url);
  return url;
}

async function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 560,
    height: 510,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#f4f8fb",
    title: "Preparando Circular Chef",
    webPreferences: {
      preload: path.join(__dirname, "setup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.removeMenu();
  await setupWindow.loadFile(path.join(__dirname, "setup.html"));
  setupWindow.webContents.send("setup:status", setupState);
  setupWindow.show();
}

function updateSetup(text, percent) {
  setupState = { text, percent: Math.max(0, Math.min(100, Number(percent) || 0)) };
  if (!setupWindow || setupWindow.isDestroyed()) return;
  setupWindow.webContents.send("setup:status", setupState);
}

function requestApiKey(message = "Introduce tu clave API de OpenAI para continuar.") {
  updateSetup("Configuración de OpenAI necesaria", 20);
  setupWindow?.webContents.send("setup:request-api-key", { message });
  return new Promise((resolve) => {
    pendingApiKey = { resolve };
  });
}

function isLocalAppUrl(candidate, origin) {
  try {
    return new URL(candidate).origin === origin;
  } catch {
    return false;
  }
}

async function createMainWindow(url) {
  const origin = new URL(url).origin;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f8fb",
    title: "Circular Chef",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isLocalAppUrl(target, origin)) void shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isLocalAppUrl(target, origin)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  await mainWindow.loadURL(url);
  mainWindow.show();
  setupWindow?.close();
  setupWindow = undefined;
}

async function bootstrap() {
  updateSetup("Comprobando la configuración de OpenAI…", 8);
  let apiKey = await loadApiKey();

  if (apiKey) {
    try {
      await validateApiKey(apiKey);
    } catch (error) {
      await log(`[openai] ${error.message}`);
      apiKey = "";
    }
  }

  if (!apiKey) apiKey = await requestApiKey();
  const url = await startWebApp(apiKey);
  updateSetup("Todo listo", 100);
  await createMainWindow(url);
}

async function startWithRecovery() {
  try {
    await bootstrap();
  } catch (error) {
    await log(`[bootstrap] ERROR ${error.stack || error.message}`);
    updateSetup("No se pudo completar la preparación.", 0);
    const result = await dialog.showMessageBox(setupWindow, {
      type: "error",
      title: "Circular Chef no pudo iniciarse",
      message: "No se pudo preparar la aplicación.",
      detail: `${error.message}\n\nComprueba la conexión a Internet y la configuración de OpenAI.`,
      buttons: ["Reintentar", "Cerrar"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) return startWithRecovery();
    app.quit();
  }
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

ipcMain.handle("openai-key:submit", async (_event, submittedKey) => {
  const apiKey = typeof submittedKey === "string" ? submittedKey.trim() : "";
  if (apiKey.length < 20) return { ok: false, error: "Introduce una clave API válida." };

  try {
    updateSetup("Validando la clave con OpenAI…", 35);
    await validateApiKey(apiKey);
    const persisted = await saveApiKey(apiKey);
    pendingApiKey?.resolve(apiKey);
    pendingApiKey = undefined;
    return { ok: true, warning: persisted ? "" : "La clave se usará solo durante esta sesión." };
  } catch (error) {
    updateSetup("Configuración de OpenAI necesaria", 20);
    return { ok: false, error: error.message || "No se pudo validar la clave." };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = mainWindow || setupWindow;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    app.setName("Circular Chef");
    if (process.platform === "win32") app.setAppUserModelId("com.circularchef.app");
    app.on("web-contents-created", (_event, contents) => {
      contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    });
    await createSetupWindow();
    await startWithRecovery();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void startWithRecovery();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    stopChild(webProcess);
  });
}
