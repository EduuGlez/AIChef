"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Recipe = {
  title: string;
  summary: string;
  time_minutes: number;
  prep_time_minutes: number;
  cooking_time_minutes: number;
  difficulty: string;
  servings: number;
  portion_size: string;
  ingredients?: Array<{
    name: string;
    amount: number | null;
    unit: string;
    preparation: string;
  }>;
  uses?: string[];
  extras?: string[];
  steps?: Array<{
    number: number;
    instruction: string;
    duration_minutes: number;
    temperature: string;
  } | string>;
  waste_tip: string;
  safety_note: string;
};

type RecipeResponse = {
  introduction: string;
  recipes: Recipe[];
  discarded_items: string[];
  closing_tip: string;
};

type ConnectionState = "checking" | "online" | "offline";

type UploadedIngredient = {
  id: string;
  name: string;
  amount: string;
  unit: string;
};

const ingredientHeaders = ["ingrediente", "producto", "alimento", "nombre", "ingredient", "product", "name"];
const amountHeaders = ["cantidad", "peso", "quantity", "amount", "weight"];
const unitHeaders = ["unidad", "unidad de medida", "unit", "measure"];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findColumn(headers: string[], acceptedNames: string[]) {
  return headers.findIndex((header) => acceptedNames.includes(header));
}

function detectDelimiter(text: string) {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim()) ?? "";
  return [",", ";", "\t"].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );
}

function parseDelimitedText(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function splitAmountAndUnit(rawAmount: unknown, rawUnit: unknown) {
  const amountText = String(rawAmount ?? "").trim();
  const unitText = String(rawUnit ?? "").trim();
  if (unitText || !amountText) return { amount: amountText, unit: unitText };

  const match = amountText.match(/^(-?[\d.,]+)\s*(.*)$/);
  return match
    ? { amount: match[1], unit: match[2].trim() }
    : { amount: amountText, unit: "" };
}

function rowsToIngredients(rows: unknown[][]): UploadedIngredient[] {
  if (!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  const headerNameIndex = findColumn(headers, ingredientHeaders);
  const headerAmountIndex = findColumn(headers, amountHeaders);
  const headerUnitIndex = findColumn(headers, unitHeaders);
  const hasRecognizedHeader = headerNameIndex >= 0 || headerAmountIndex >= 0 || headerUnitIndex >= 0;
  const nameIndex = headerNameIndex >= 0 ? headerNameIndex : 0;
  const amountIndex = headerAmountIndex >= 0 ? headerAmountIndex : 1;
  const unitIndex = headerUnitIndex >= 0 ? headerUnitIndex : 2;
  const dataRows = hasRecognizedHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row, index) => {
      const name = String(row[nameIndex] ?? "").trim();
      const { amount, unit } = splitAmountAndUnit(row[amountIndex], row[unitIndex]);
      return { id: `file-${Date.now()}-${index}`, name, amount, unit };
    })
    .filter((ingredient) => ingredient.name || ingredient.amount || ingredient.unit);
}

function isCompleteIngredient(ingredient: UploadedIngredient) {
  const numericAmount = Number(ingredient.amount.replace(",", "."));
  return Boolean(ingredient.name.trim() && ingredient.unit.trim() && Number.isFinite(numericAmount) && numericAmount > 0);
}

export default function Home() {
  const [mode, setMode] = useState<"natural" | "file">("natural");
  const [description, setDescription] = useState("");
  const [uploadedIngredients, setUploadedIngredients] = useState<UploadedIngredient[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [servings, setServings] = useState("4");
  const [maxTime, setMaxTime] = useState("45");
  const [restrictions, setRestrictions] = useState("");
  const [style, setStyle] = useState("Cocina canaria y mediterránea");
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [result, setResult] = useState<RecipeResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const sourceText = useMemo(() => {
    if (mode === "natural") return description;
    if (!uploadedIngredients.length) return "";
    return [
      "Alimentos sobrantes revisados desde un archivo:",
      ...uploadedIngredients.map(({ name, amount, unit }) => `- ${amount} ${unit} de ${name}`),
    ].join("\n");
  }, [description, mode, uploadedIngredients]);

  function updateUploadedIngredient(id: string, field: keyof Omit<UploadedIngredient, "id">, value: string) {
    setUploadedIngredients((current) =>
      current.map((ingredient) => ingredient.id === id ? { ...ingredient, [field]: value } : ingredient),
    );
    setError("");
  }

  function removeUploadedIngredient(id: string) {
    setUploadedIngredients((current) => current.filter((ingredient) => ingredient.id !== id));
  }

  function addUploadedIngredient() {
    setUploadedIngredients((current) => [
      ...current,
      { id: `manual-${Date.now()}`, name: "", amount: "", unit: "" },
    ]);
  }

  function clearUploadedFile() {
    setUploadedIngredients([]);
    setFileName("");
    setFileError("");
    setError("");
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx") {
      setFileError("El archivo debe estar en formato CSV o Excel (.xlsx).");
      return;
    }

    setIsParsingFile(true);
    setFileError("");
    setError("");

    try {
      let rows: unknown[][];
      if (extension === "csv") {
        const text = await file.text();
        rows = parseDelimitedText(text, detectDelimiter(text));
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        rows = await readSheet(file);
      }

      const parsedIngredients = rowsToIngredients(rows);
      if (!parsedIngredients.length) {
        throw new Error("No se encontraron ingredientes en el archivo.");
      }
      if (parsedIngredients.length > 500) {
        throw new Error("El archivo contiene más de 500 ingredientes. Divídelo en archivos más pequeños.");
      }

      setUploadedIngredients(parsedIngredients);
      setFileName(file.name);
    } catch (caught) {
      setUploadedIngredients([]);
      setFileName("");
      setFileError(caught instanceof Error ? caught.message : "No se pudo leer el archivo.");
    } finally {
      setIsParsingFile(false);
    }
  }

  const checkConnection = useCallback(async () => {
    setConnection("checking");
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      setConnection("online");
    } catch {
      setConnection("offline");
    }
  }, []);

  useEffect(() => {
    const connectionCheck = window.setTimeout(() => void checkConnection(), 0);
    return () => window.clearTimeout(connectionCheck);
  }, [checkConnection]);

  async function generateRecipes(event: FormEvent) {
    event.preventDefault();
    if (mode === "file" && uploadedIngredients.some((ingredient) => !isCompleteIngredient(ingredient))) {
      setError("Revisa las filas incompletas: cada ingrediente necesita nombre, cantidad mayor que cero y unidad.");
      return;
    }
    if (!sourceText.trim()) {
      setError(mode === "file" ? "Sube primero un archivo CSV o Excel con los sobrantes." : "Indica primero qué alimentos han sobrado.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: sourceText.trim(),
          servings: Number(servings) || 4,
          maxTime: Number(maxTime) || 45,
          restrictions: restrictions.trim(),
          style: style.trim(),
        }),
      });

      const data = (await response.json()) as RecipeResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudieron generar las recetas.");
      setResult(data);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron generar las recetas.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="AI Chef de Effiwaste, inicio">
          <span className="brand-mark" aria-hidden="true">Effiwaste</span>
          <span className="brand-product">
            <strong>AI Chef</strong>
            <small>Asistente de cocina</small>
          </span>
        </a>
        <button
          className={`connection ${connection}`}
          type="button"
          onClick={() => void checkConnection()}
          aria-label="Comprobar conexión con Ollama"
        >
          <span className="connection-dot" />
          {connection === "online"
            ? "Ollama conectado"
            : connection === "checking"
              ? "Comprobando Ollama"
              : "Ollama sin conexión"}
        </button>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>●</span> Cocina circular asistida por IA</div>
        <h1>Convierte lo que ha sobrado en <em>algo delicioso.</em></h1>
        <p>
          Cuéntanos qué alimentos tienes disponibles y AI Chef propondrá
          recetas prácticas para aprovecharlos mejor.
        </p>
        <div className="flow" aria-label="Cómo funciona">
          <span><b>1</b> Escribe o sube un archivo</span>
          <i>→</i>
          <span><b>2</b> Revisa las cantidades</span>
          <i>→</i>
          <span><b>3</b> Cocina y aprovecha</span>
        </div>
      </section>

      <section className="workspace" aria-label="Generador de recetas">
        <div className="generator-card">
          <div className="tabs" role="tablist" aria-label="Modo de entrada">
            <button
              className={mode === "natural" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "natural"}
              onClick={() => setMode("natural")}
            >
              Escribir sobrantes
            </button>
            <button
              className={mode === "file" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === "file"}
              onClick={() => setMode("file")}
            >
              Subir CSV / Excel
            </button>
          </div>

          <form onSubmit={generateRecipes}>
            {mode === "natural" ? (
              <div className="field large-field">
                <label htmlFor="description">¿Qué ha sobrado hoy?</label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Ej.: Han sobrado 2 kg de tomates maduros, pan del desayuno y medio kilo de queso. Quiero preparar algo para 6 personas..."
                  rows={6}
                />
              </div>
            ) : (
              <div className="file-input-area">
                <label className="file-drop" htmlFor="waste-file">
                  <input
                    id="waste-file"
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={handleFileChange}
                    disabled={isParsingFile}
                  />
                  <span className="upload-icon" aria-hidden="true">↑</span>
                  <strong>{isParsingFile ? "Leyendo el archivo…" : "Selecciona un CSV o Excel"}</strong>
                  <small>Columnas recomendadas: ingrediente, cantidad y unidad</small>
                </label>
                <p className="privacy-hint">El archivo se lee en este navegador y no se envía a ningún servicio externo.</p>
                {fileError && <div className="notice error" role="alert">{fileError}</div>}

                {uploadedIngredients.length > 0 && (
                  <section className="file-preview" aria-label="Previsualización de ingredientes">
                    <div className="preview-header">
                      <div>
                        <span className="preview-kicker">PREVISUALIZACIÓN</span>
                        <h3>Revisa los sobrantes antes de generar</h3>
                        <p>{fileName || "Lista editada"} · {uploadedIngredients.length} ingrediente{uploadedIngredients.length === 1 ? "" : "s"}</p>
                      </div>
                      <button className="clear-file" type="button" onClick={clearUploadedFile}>Quitar archivo</button>
                    </div>
                    <div className="preview-table" role="table" aria-label="Ingredientes y cantidades importados">
                      <div className="preview-row preview-labels" role="row">
                        <span role="columnheader">Ingrediente</span>
                        <span role="columnheader">Cantidad</span>
                        <span role="columnheader">Unidad</span>
                        <span className="sr-only" role="columnheader">Acciones</span>
                      </div>
                      {uploadedIngredients.map((ingredient, index) => (
                        <div
                          className={`preview-row ${isCompleteIngredient(ingredient) ? "" : "incomplete"}`}
                          role="row"
                          key={ingredient.id}
                        >
                          <label>
                            <span>Ingrediente</span>
                            <input
                              aria-label={`Ingrediente ${index + 1}`}
                              value={ingredient.name}
                              onChange={(event) => updateUploadedIngredient(ingredient.id, "name", event.target.value)}
                              placeholder="Ej.: tomate"
                            />
                          </label>
                          <label>
                            <span>Cantidad</span>
                            <input
                              aria-label={`Cantidad de ${ingredient.name || `ingrediente ${index + 1}`}`}
                              inputMode="decimal"
                              value={ingredient.amount}
                              onChange={(event) => updateUploadedIngredient(ingredient.id, "amount", event.target.value)}
                              placeholder="Ej.: 2,5"
                            />
                          </label>
                          <label>
                            <span>Unidad</span>
                            <input
                              aria-label={`Unidad de ${ingredient.name || `ingrediente ${index + 1}`}`}
                              value={ingredient.unit}
                              onChange={(event) => updateUploadedIngredient(ingredient.id, "unit", event.target.value)}
                              placeholder="kg, g, ud…"
                            />
                          </label>
                          <button
                            className="row-delete"
                            type="button"
                            onClick={() => removeUploadedIngredient(ingredient.id)}
                            aria-label={`Eliminar ${ingredient.name || `fila ${index + 1}`}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="preview-footer">
                      <button className="add-row" type="button" onClick={addUploadedIngredient}>+ Añadir ingrediente</button>
                      <span>Todos los campos son obligatorios</span>
                    </div>
                  </section>
                )}
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="servings">Comensales</label>
                <input
                  id="servings"
                  type="number"
                  min="1"
                  max="100"
                  value={servings}
                  onChange={(event) => setServings(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="time">Tiempo máximo</label>
                <select id="time" value={maxTime} onChange={(event) => setMaxTime(event.target.value)}>
                  <option value="20">20 minutos</option>
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">60 minutos</option>
                  <option value="90">90 minutos</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="style">Tipo de cocina</label>
                <input id="style" value={style} onChange={(event) => setStyle(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="restrictions">Alergias o restricciones</label>
                <input
                  id="restrictions"
                  value={restrictions}
                  onChange={(event) => setRestrictions(event.target.value)}
                  placeholder="Ej.: sin gluten, vegetariano..."
                />
              </div>
            </div>

            {connection === "offline" && (
              <div className="notice warning" role="status">
                <b>Ollama no está disponible.</b>
                <span>Inícialo y después pulsa el indicador de conexión.</span>
              </div>
            )}
            {error && <div className="notice error" role="alert">{error}</div>}

            <button className="generate-button" type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Pensando recetas…</> : <>Generar 3 recetas <span>→</span></>}
            </button>
          </form>
        </div>

        <aside className="side-card">
          <span className="side-icon" aria-hidden="true">↺</span>
          <h2>Aprovecha más.<br />Desperdicia menos.</h2>
          <p>Cada ingrediente recuperado reduce costes y evita residuos innecesarios.</p>
          <div className="safety-note">
            <b>Seguridad primero</b>
            Utiliza únicamente alimentos no servidos, en buen estado y conservados según tu sistema APPCC.
          </div>
        </aside>
      </section>

      {result && (
        <section className="results" aria-live="polite">
          <div className="results-heading">
            <div><span className="section-number">03</span><p>PROPUESTAS</p></div>
            <h2>Tres formas de aprovecharlo</h2>
            <p>{result.introduction}</p>
          </div>

          {result.discarded_items?.length > 0 && (
            <div className="discard-warning">
              <b>No se han utilizado por seguridad:</b> {result.discarded_items.join(", ")}
            </div>
          )}

          <div className="recipe-grid">
            {result.recipes.map((recipe, index) => {
              const recipeIngredients = recipe.ingredients ?? [
                ...(recipe.uses ?? []).map((name) => ({
                  name,
                  amount: null,
                  unit: "",
                  preparation: "Preparación no especificada",
                })),
                ...(recipe.extras ?? []).map((name) => ({
                  name,
                  amount: null,
                  unit: "",
                  preparation: "Preparación no especificada",
                })),
              ];
              const recipeSteps = (recipe.steps ?? []).map((step, stepIndex) =>
                typeof step === "string"
                  ? {
                      number: stepIndex + 1,
                      instruction: step,
                      duration_minutes: 0,
                      temperature: "",
                    }
                  : step,
              );

              return (
              <article className="recipe-card" key={`${recipe.title}-${index}`}>
                <div className="recipe-topline">
                  <span>RECETA {String(index + 1).padStart(2, "0")}</span>
                  <span>{recipe.difficulty}</span>
                </div>
                <h3>{recipe.title}</h3>
                <p>{recipe.summary}</p>
                <div className="recipe-meta">
                  <span>◷ {recipe.time_minutes} min en total</span>
                  {recipe.prep_time_minutes != null && <span>Preparación: {recipe.prep_time_minutes} min</span>}
                  {recipe.cooking_time_minutes != null && <span>Cocción: {recipe.cooking_time_minutes} min</span>}
                  <span>♙ {recipe.servings} raciones</span>
                  {recipe.portion_size && <span>{recipe.portion_size}</span>}
                </div>
                <div className="recipe-content">
                  <div className="ingredient-block">
                    <h4>Ingredientes y cantidades</h4>
                    <p className="section-helper">Para {recipe.servings} raciones</p>
                    <ul className="ingredients-list">
                      {recipeIngredients.map((ingredient, ingredientIndex) => (
                        <li key={`${ingredient.name}-${ingredientIndex}`}>
                          <div>
                            <b>
                              {ingredient.amount != null
                                ? `${ingredient.amount} ${ingredient.unit}`
                                : "Cantidad no indicada"}
                            </b>
                            <span>{ingredient.name}</span>
                          </div>
                          <small>
                            {ingredient.preparation}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="procedure-block">
                    <h4>Elaboración paso a paso</h4>
                    <p className="section-helper">Sigue los pasos en este orden</p>
                    <ol className="steps-list">
                      {recipeSteps.map((step, stepIndex) => (
                        <li key={`${step.number}-${stepIndex}`}>
                          <span className="step-number">{step.number}</span>
                          <div>
                            <p>{step.instruction}</p>
                            <small>
                              {step.duration_minutes > 0 ? `${step.duration_minutes} min` : ""}
                              {step.temperature && step.temperature.toLowerCase() !== "no aplica"
                                ? `${step.duration_minutes > 0 ? " · " : ""}${step.temperature}`
                                : ""}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
                <div className="recipe-footer">
                  <div className="tip"><b>Consejo circular</b>{recipe.waste_tip}</div>
                  {recipe.safety_note && <small className="recipe-safety"><b>Control APPCC</b>{recipe.safety_note}</small>}
                </div>
              </article>
              );
            })}
          </div>
          <p className="closing-tip">{result.closing_tip}</p>
        </section>
      )}

      <footer>
        <span>Effiwaste · AI Chef</span>
        <span>La IA propone; el equipo de cocina valida.</span>
      </footer>
    </main>
  );
}
