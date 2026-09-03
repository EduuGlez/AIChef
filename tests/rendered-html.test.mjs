import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("contains the complete AI Chef recipe flow", async () => {
  const [page, recipesRoute, modelsRoute, ollamaClient, layout, styles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/recipes/route.ts", root), "utf8"),
    readFile(new URL("app/api/models/route.ts", root), "utf8"),
    readFile(new URL("app/lib/ollama.ts", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /Escribir sobrantes/);
  assert.match(page, /Effiwaste/);
  assert.match(page, /AI Chef/);
  assert.match(page, /Subir CSV \/ Excel/);
  assert.match(page, /accept="\.csv,\.xlsx"/);
  assert.match(page, /PREVISUALIZACIÓN/);
  assert.match(page, /read-excel-file\/browser/);
  assert.match(page, /readSheet\(file\)/);
  assert.match(page, /ingrediente, cantidad y unidad/);
  assert.doesNotMatch(page, /Formulario guiado/);
  assert.match(page, /Generar 3 recetas/);
  assert.match(page, /Ollama conectado/);
  assert.match(page, /sistema APPCC/);
  assert.match(page, /Ingredientes y cantidades/);
  assert.match(page, /Elaboración paso a paso/);
  assert.match(page, /recipe\.ingredients \?\?/);
  assert.match(page, /recipe\.uses \?\?/);
  assert.match(recipesRoute, /ollamaFetch\("api\/chat"/);
  assert.match(recipesRoute, /exactamente 3 recetas/);
  assert.match(recipesRoute, /prep_time_minutes/);
  assert.match(recipesRoute, /duration_minutes/);
  assert.match(recipesRoute, /No uses expresiones vagas/);
  assert.match(recipesRoute, /model: getOllamaModel\(\)/);
  assert.match(recipesRoute, /export const maxDuration = 300/);
  assert.doesNotMatch(recipesRoute, /body\.model|origin:/);
  assert.match(modelsRoute, /ollamaFetch\("api\/tags"/);
  assert.match(ollamaClient, /OLLAMA_API_KEY/);
  assert.match(ollamaClient, /Authorization/);
  assert.match(ollamaClient, /El Ollama remoto debe estar protegido con HTTPS/);
  assert.match(layout, /AI Chef \| Effiwaste/);
  assert.doesNotMatch(page, /Prueba con:|Modelo local|100 % local|Modelo de Ollama|Nombre del modelo|ingredient\.origin/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /WRANGLER_LOG_PATH=/);
  assert.match(packageJson, /"dev": "next dev"/);
  assert.match(packageJson, /"build": "next build --webpack"/);
  assert.match(packageJson, /"build:sites": "vinext build"/);
  assert.match(layout, /@fontsource-variable\/montserrat\/wght\.css/);
  assert.match(layout, /@fontsource-variable\/roboto\/wght\.css/);
  assert.match(styles, /--green: #0b5394/);
  assert.match(styles, /--terracotta: #00b6bd/);
  assert.match(styles, /--lime: #6bac00/);
  assert.match(styles, /font-family: "Roboto Variable"/);
  assert.match(styles, /"Montserrat Variable"/);
});

test("includes the project social image and removes the starter preview", async () => {
  await access(new URL("public/og.png", root));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
  await assert.rejects(access(new URL("app/_sites-preview/preview.css", root)));
});
