import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("contains the complete Circular Chef recipe flow", async () => {
  const [page, recipesRoute, modelsRoute, openAIClient, recipePdf, layout, styles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/recipes/route.ts", root), "utf8"),
    readFile(new URL("app/api/models/route.ts", root), "utf8"),
    readFile(new URL("app/lib/openai.ts", root), "utf8"),
    readFile(new URL("app/lib/recipe-pdf.ts", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /Escribir sobrantes/);
  assert.match(page, /Circular Chef/);
  assert.doesNotMatch(page, /Effiwaste/i);
  assert.match(page, /Subir CSV \/ Excel/);
  assert.match(page, /accept="\.csv,\.xlsx"/);
  assert.match(page, /PREVISUALIZACIÓN/);
  assert.match(page, /read-excel-file\/browser/);
  assert.match(page, /readSheet\(file\)/);
  assert.match(page, /ingrediente, cantidad y unidad/);
  assert.match(page, /Generar 3 recetas/);
  assert.match(page, /OpenAI conectado/);
  assert.match(page, /sistema APPCC/);
  assert.match(page, /Ingredientes y cantidades/);
  assert.match(page, /Elaboración paso a paso/);
  assert.match(page, /recipe\.ingredients \?\?/);
  assert.match(page, /recipe\.uses \?\?/);
  assert.match(recipesRoute, /openAIFetch\("responses"/);
  assert.match(recipesRoute, /exactamente 1 receta/);
  assert.match(recipesRoute, /minItems: 1/);
  assert.match(recipesRoute, /maxItems: 1/);
  assert.match(recipesRoute, /previousRecipes/);
  assert.match(page, /for \(let recipeNumber = 1; recipeNumber <= 3; recipeNumber \+= 1\)/);
  assert.match(page, /recipes: \[\.\.\.accumulatedRecipes\]/);
  assert.match(page, /Generando receta \{generatingRecipe\} de 3/);
  assert.match(page, /Descargar PDF/);
  assert.match(page, /handleRecipeDownload\(recipe, index \+ 1\)/);
  assert.match(page, /await downloadRecipePdf\(recipe, recipeNumber\)/);
  assert.match(recipePdf, /await import\("jspdf"\)/);
  assert.match(recipePdf, /Elaboración paso a paso/);
  assert.match(recipePdf, /Control APPCC/);
  assert.match(recipePdf, /doc\.save\(safeFilename\(recipe\.title\)\)/);
  assert.match(recipesRoute, /prep_time_minutes/);
  assert.match(recipesRoute, /duration_minutes/);
  assert.match(recipesRoute, /No uses expresiones vagas/);
  assert.match(recipesRoute, /model: getOpenAIModel\(\)/);
  assert.match(recipesRoute, /type: "json_schema"/);
  assert.match(recipesRoute, /strict: true/);
  assert.match(recipesRoute, /store: false/);
  assert.match(recipesRoute, /export const maxDuration = 300/);
  assert.doesNotMatch(recipesRoute, /body\.model|origin:/);
  assert.match(modelsRoute, /openAIFetch\(`models\//);
  assert.match(openAIClient, /OPENAI_API_KEY/);
  assert.match(openAIClient, /Authorization/);
  assert.match(openAIClient, /https:\/\/api\.openai\.com\/v1\//);
  assert.match(layout, /Circular Chef \| Cocina circular con IA/);
  assert.match(page, /https:\/\/www\.fu-tourism\.eu\//);
  assert.match(page, /\/fu-tourism-logo\.png/);
  assert.match(page, /\/europa\.jpeg/);
  assert.doesNotMatch(page, /Prueba con:|Modelo local|100 % local|Nombre del modelo|ingredient\.origin/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
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
