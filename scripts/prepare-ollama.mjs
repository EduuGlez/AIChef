import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platformArgument = process.argv.indexOf("--platform");
const targetPlatform = platformArgument >= 0 ? process.argv[platformArgument + 1] : process.platform;
const targetNames = {
  darwin: "ollama-darwin",
  win32: "ollama-win32-x64",
  linux: "ollama-linux-x64",
};
const targetName = targetNames[targetPlatform];
if (!targetName) throw new Error(`Sistema no compatible: ${targetPlatform}`);
const target = path.join(projectRoot, ".desktop-vendor", targetName);
const cacheDirectory = path.join(projectRoot, ".desktop-cache");

const WINDOWS_OLLAMA_VERSION = "v0.33.2";
const WINDOWS_OLLAMA_SHA256 = "2439cbea65310b1aadf7d8fc41d7faf5d033f920d42e00a476c58bf9bff6950e";

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} terminó con el código ${result.status ?? "desconocido"}`);
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function findFile(directory, name) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const match = await findFile(candidate, name);
      if (match) return match;
    }
  }
  return undefined;
}

async function downloadVerified(url, archive, expectedHash) {
  if ((await exists(archive)) && (await sha256(archive)) === expectedHash) return;

  await rm(archive, { force: true });
  run("curl", ["--fail", "--location", "--progress-bar", "-o", archive, url]);
  const actualHash = await sha256(archive);
  if (actualHash !== expectedHash) {
    await rm(archive, { force: true });
    throw new Error(`La verificación SHA-256 de Ollama falló: ${actualHash}`);
  }
}

async function prepareMac() {
  const configured = process.env.EFFIWASTE_OLLAMA_RESOURCES;
  let source = configured || "/Applications/Ollama.app/Contents/Resources";
  let temporaryDirectory;

  if (!(await exists(path.join(source, "ollama")))) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "effiwaste-ollama-"));
    const archive = path.join(temporaryDirectory, "Ollama-darwin.zip");
    console.log("Ollama no está instalado; descargando el paquete oficial para macOS…");
    run("curl", ["--fail", "--location", "--progress-bar", "-o", archive,
      "https://ollama.com/download/Ollama-darwin.zip"]);
    run("ditto", ["-x", "-k", archive, temporaryDirectory]);
    source = path.join(temporaryDirectory, "Ollama.app", "Contents", "Resources");
  }

  await cp(source, target, { recursive: true, dereference: false });
  await chmod(path.join(target, "ollama"), 0o755);
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}

async function prepareWindows() {
  const configured = process.env.EFFIWASTE_OLLAMA_RESOURCES;
  if (configured) {
    const executable = path.join(configured, "ollama.exe");
    if (!(await exists(executable))) throw new Error(`No se encontró ${executable}.`);
    await cp(configured, target, { recursive: true, dereference: false });
    return;
  }

  await mkdir(cacheDirectory, { recursive: true });
  const archive = path.join(cacheDirectory, `ollama-windows-amd64-${WINDOWS_OLLAMA_VERSION}.zip`);
  const url = `https://github.com/ollama/ollama/releases/download/${WINDOWS_OLLAMA_VERSION}/ollama-windows-amd64.zip`;
  console.log(`Descargando Ollama ${WINDOWS_OLLAMA_VERSION} oficial para Windows x64…`);
  await downloadVerified(url, archive, WINDOWS_OLLAMA_SHA256);

  const extractionDirectory = await mkdtemp(path.join(tmpdir(), "effiwaste-ollama-windows-"));
  try {
    run("unzip", ["-q", archive, "-d", extractionDirectory]);
    const executable = await findFile(extractionDirectory, "ollama.exe");
    if (!executable) throw new Error("El paquete oficial no contiene ollama.exe.");
    await cp(path.dirname(executable), target, { recursive: true, dereference: false });
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
}

async function prepareLinux() {
  const configured = process.env.EFFIWASTE_OLLAMA_RESOURCES;
  const source = configured || "/usr/lib/ollama";
  if (!(await exists(source))) {
    throw new Error(
      "Instala Ollama antes de construir el AppImage o define EFFIWASTE_OLLAMA_RESOURCES.",
    );
  }
  await cp(source, target, { recursive: true, dereference: false });
  const binary = process.env.EFFIWASTE_OLLAMA_BINARY || "/usr/bin/ollama";
  if (!(await exists(binary))) throw new Error(`No se encontró el ejecutable de Ollama en ${binary}.`);
  await cp(binary, path.join(target, "ollama"));
  await chmod(path.join(target, "ollama"), 0o755);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

try {
  if (targetPlatform === "darwin") await prepareMac();
  else if (targetPlatform === "win32") await prepareWindows();
  else if (targetPlatform === "linux") await prepareLinux();

  console.log(`Ollama preparado en ${path.relative(projectRoot, target)}.`);
} catch (error) {
  await rm(target, { recursive: true, force: true });
  throw error;
}
