const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFile, access, mkdir } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const MODEL = "llama3.2:3b";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;

let setupWindow;
let mainWindow;
let ollamaProcess;
let webProcess;
let quitting = false;

function resourcePath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(root, ...parts);
}

function webAppPath() {
  return app.isPackaged
    ? resourcePath("webapp")
    : path.join(__dirname, "..", "dist", "standalone");
}

function ollamaDirectory() {
  return app.isPackaged
    ? resourcePath("ollama")
    : path.join(__dirname, "..", ".desktop-vendor", "ollama");
}

function ollamaExecutable() {
  return path.join(ollamaDirectory(), process.platform === "win32" ? "ollama.exe" : "ollama");
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

async function getInstalledModels() {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 4000);
  if (!response.ok) throw new Error(`Ollama respondió con HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.models) ? data.models : [];
}

async function waitForOllama(timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await getInstalledModels();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error(`Ollama no pudo iniciarse: ${lastError?.message || "tiempo de espera agotado"}`);
}

async function ensureOllama() {
  try {
    return await getInstalledModels();
  } catch {
    if (OLLAMA_URL !== DEFAULT_OLLAMA_URL) {
      throw new Error(`No se puede conectar con Ollama en ${OLLAMA_URL}.`);
    }
  }

  const executable = ollamaExecutable();
  await access(executable);
  updateSetup("Iniciando el motor de inteligencia artificial…", 12);

  ollamaProcess = spawn(executable, ["serve"], {
    cwd: ollamaDirectory(),
    env: {
      ...process.env,
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_NO_CLOUD: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  captureProcessOutput(ollamaProcess, "ollama");
  return waitForOllama();
}

function hasRequiredModel(models) {
  return models.some((entry) => entry?.name === MODEL || entry?.model === MODEL);
}

function pullProgressMessage(event) {
  if (event.total > 0 && event.completed >= 0) {
    const percent = Math.min(100, Math.round((event.completed / event.total) * 100));
    return {
      text: `Descargando el modelo de cocina… ${percent} %`,
      percent: 18 + Math.round(percent * 0.62),
    };
  }
  return { text: event.status || "Preparando el modelo de cocina…", percent: 18 };
}

async function ensureModel(models) {
  if (hasRequiredModel(models)) return;

  updateSetup("Descargando el modelo de cocina por primera vez…", 18);
  const response = await fetchWithTimeout(
    `${OLLAMA_URL}/api/pull`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, stream: true }),
    },
    30 * 60 * 1000,
  );

  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar ${MODEL} (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const progress = pullProgressMessage(event);
      updateSetup(progress.text, progress.percent);
    }

    if (done) break;
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

async function waitForWebApp(url, timeout = 60000) {
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

async function startWebApp() {
  if (webProcess) return webProcess.url;

  const appDirectory = webAppPath();
  const entry = path.join(appDirectory, "server.js");
  await access(entry);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  updateSetup("Iniciando AI Chef…", 88);
  webProcess = spawn(process.execPath, [entry], {
    cwd: appDirectory,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: "127.0.0.1",
      PORT: String(port),
      OLLAMA_BASE_URL: OLLAMA_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  webProcess.url = url;
  captureProcessOutput(webProcess, "web");
  await waitForWebApp(url);
  return url;
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 540,
    height: 360,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#f4f8fb",
    title: "Preparando Circular Chef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.removeMenu();
  setupWindow.loadFile(path.join(__dirname, "setup.html"));
  setupWindow.once("ready-to-show", () => setupWindow?.show());
}

function updateSetup(text, percent) {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  const safeText = JSON.stringify(text);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  void setupWindow.webContents.executeJavaScript(
    `document.getElementById("status").textContent = ${safeText};` +
      `document.getElementById("progress").style.width = "${safePercent}%";`,
  );
}

function isLocalAppUrl(candidate, origin) {
  try {
    const url = new URL(candidate);
    return url.origin === origin;
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
  updateSetup("Comprobando Ollama…", 5);
  const models = await ensureOllama();
  await ensureModel(models);
  const url = await startWebApp();
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
      detail: `${error.message}\n\nComprueba la conexión a Internet y el espacio disponible.`,
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
    createSetupWindow();
    await startWithRecovery();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void startWithRecovery();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (quitting) return;
    quitting = true;
    stopChild(webProcess);
    stopChild(ollamaProcess);
  });
}
