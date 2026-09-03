import {
  getOllamaModel,
  OllamaConfigurationError,
  ollamaFetch,
} from "../../lib/ollama";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DESCRIPTION_LENGTH = 12_000;
const MAX_RESTRICTIONS_LENGTH = 1_000;
const MAX_STYLE_LENGTH = 200;

const recipeSchema = {
  type: "object",
  properties: {
    introduction: { type: "string" },
    recipes: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          time_minutes: { type: "integer" },
          prep_time_minutes: { type: "integer" },
          cooking_time_minutes: { type: "integer" },
          difficulty: { type: "string" },
          servings: { type: "integer" },
          portion_size: { type: "string" },
          ingredients: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "number" },
                unit: {
                  type: "string",
                  enum: ["g", "kg", "ml", "l", "unidad", "cucharadita", "cucharada"],
                },
                preparation: { type: "string" },
              },
              required: ["name", "amount", "unit", "preparation"],
            },
          },
          steps: {
            type: "array",
            minItems: 5,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                number: { type: "integer" },
                instruction: { type: "string" },
                duration_minutes: { type: "integer" },
                temperature: { type: "string" },
              },
              required: ["number", "instruction", "duration_minutes", "temperature"],
            },
          },
          waste_tip: { type: "string" },
          safety_note: { type: "string" },
        },
        required: [
          "title", "summary", "time_minutes", "prep_time_minutes",
          "cooking_time_minutes", "difficulty", "servings", "portion_size",
          "ingredients", "steps", "waste_tip", "safety_note",
        ],
      },
    },
    discarded_items: { type: "array", items: { type: "string" } },
    closing_tip: { type: "string" },
  },
  required: ["introduction", "recipes", "discarded_items", "closing_tip"],
};

function normalizeContent(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function isCrossOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host"))
    ?.split(",")[0]
    .trim();
  const protocol = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol)
    .split(",")[0]
    .replace(/:$/, "")
    .trim();

  return !host || origin !== `${protocol}://${host}`;
}

export async function POST(request: Request) {
  try {
    if (isCrossOriginRequest(request)) {
      return Response.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
    }

    const body = (await request.json()) as {
      description?: string;
      servings?: number;
      maxTime?: number;
      restrictions?: string;
      style?: string;
    };

    const description = boundedText(body.description, MAX_DESCRIPTION_LENGTH);
    const servings = boundedInteger(body.servings, 4, 1, 100);
    const maxTime = boundedInteger(body.maxTime, 45, 10, 180);
    const restrictions = boundedText(body.restrictions, MAX_RESTRICTIONS_LENGTH);
    const style = boundedText(body.style, MAX_STYLE_LENGTH);

    if (!description) {
      return Response.json({ error: "Indica qué alimentos han sobrado." }, { status: 400 });
    }

    if (typeof body.description === "string" && body.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      return Response.json(
        { error: "La lista de alimentos es demasiado larga. Reduce el contenido e inténtalo de nuevo." },
        { status: 413 },
      );
    }

    const prompt = `
OBJETIVO
Crear exactamente 3 recetas profesionales, diferentes entre sí, detalladas y realmente
ejecutables en una cocina. Deben aprovechar los alimentos disponibles sin sacrificar la
calidad culinaria ni la seguridad alimentaria.

DATOS DE PARTIDA
- Alimentos disponibles: ${description}
- Número exacto de comensales: ${servings}
- Tiempo máximo total por receta: ${maxTime} minutos
- Estilo culinario solicitado: ${style || "cocina sencilla y mediterránea"}
- Restricciones o alergias: ${restrictions || "ninguna indicada"}

REGLAS PARA LOS INGREDIENTES
1. Incluye en ingredients TODOS los ingredientes necesarios, tanto los sobrantes como los
   ingredientes básicos de despensa. No menciones ningún ingrediente en los pasos si no aparece
   antes en ingredients.
2. Calcula las cantidades para el número exacto de comensales. Cada ingrediente debe tener una
   cantidad numérica y una unidad métrica o doméstica admitida por el esquema.
3. No uses expresiones vagas como “al gusto”, “un poco”, “cantidad necesaria”, “un chorrito” o
   “una pizca”. Cuantifica también el aceite, la sal, las especias, el agua y las guarniciones.
4. No dupliques ingredientes. En preparation indica la preparación previa exacta: lavado,
   pelado, escurrido, corte y tamaño del corte, cuando proceda.
5. Añade pocos ingredientes básicos adicionales a los alimentos aportados por el usuario.
6. Si el usuario no facilita cantidades, realiza una estimación culinaria razonable y coherente
   con las raciones. No afirmes que el usuario dispone de una cantidad que no haya indicado.

REGLAS PARA LA ELABORACIÓN
1. Escribe entre 5 y 10 pasos numerados consecutivamente desde 1, sin saltos ni repeticiones.
2. Cada paso debe explicar una acción concreta: qué se hace, con qué ingredientes, durante
   cuánto tiempo y a qué temperatura o potencia cuando corresponda.
3. Incluye señales observables del punto correcto: color, textura, reducción, temperatura
   interior o consistencia. No des por supuesto conocimientos profesionales avanzados.
4. Mantén el orden real de trabajo: mise en place, preparación, cocción, ajuste final y servicio.
5. La suma de prep_time_minutes y cooking_time_minutes debe ser igual a time_minutes, y
   time_minutes no puede superar el tiempo máximo solicitado.
6. Evita pasos genéricos como “cocinar hasta que esté hecho” o “preparar normalmente”.

CALIDAD Y SEGURIDAD
- Las tres recetas deben utilizar técnicas o presentaciones claramente diferentes.
- Respeta estrictamente todas las restricciones y alergias indicadas.
- No uses alimentos deteriorados, restos de platos de clientes, productos de procedencia dudosa
  ni alimentos que puedan no ser seguros. Añádelos a discarded_items con un motivo breve y
  prudente, sin diagnosticar su estado si faltan datos.
- No inventes procesos que hagan seguro un alimento potencialmente inseguro.
- Explica en safety_note la comprobación esencial que debe realizar la cocina para esa receta.
- Toda propuesta debe ser validada por el responsable de cocina y por el sistema APPCC del centro.

SALIDA
- Escribe en español claro y profesional.
- Devuelve exclusivamente un objeto JSON válido que cumpla exactamente el esquema proporcionado.
- No añadas Markdown, comentarios, encabezados ni texto fuera del JSON.`;

    const response = await ollamaFetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        stream: false,
        format: recipeSchema,
        options: {
          temperature: 0.2,
          num_predict: 3600,
          num_ctx: 8192,
          repeat_penalty: 1.08,
        },
        messages: [
          {
            role: "system",
            content: `Eres un chef ejecutivo especializado en cocina hotelera, estandarización
de recetas, escandallos, reaprovechamiento y seguridad alimentaria. Redactas recetas precisas,
coherentes y reproducibles por otro equipo de cocina. Compruebas mentalmente cantidades,
raciones, tiempos, temperaturas, alérgenos y correspondencia entre ingredientes y pasos antes
de responder. Priorizas exactitud y viabilidad sobre creatividad. Respondes únicamente con JSON
válido que cumple el esquema solicitado.`,
          },
          { role: "user", content: prompt },
        ],
      }),
    }, 285_000);

    const responseText = await response.text();
    let data: {
      message?: { content?: string };
      error?: string;
    } = {};

    try {
      data = JSON.parse(responseText) as typeof data;
    } catch {
      if (response.ok) throw new SyntaxError("Ollama devolvió una respuesta no JSON.");
    }

    if (!response.ok) {
      console.error("Ollama rechazó la generación", response.status, data.error || "sin detalle");
      return Response.json(
        { error: "El servicio de IA no pudo procesar la solicitud." },
        { status: response.status >= 400 && response.status < 500 ? 502 : 503 },
      );
    }

    if (!data.message?.content) {
      return Response.json({ error: "Ollama devolvió una respuesta vacía." }, { status: 502 });
    }

    const recipes = normalizeContent(data.message.content);
    return Response.json(recipes);
  } catch (error) {
    if (error instanceof OllamaConfigurationError) {
      console.error(error.message);
      return Response.json(
        { error: "El servicio de IA no está configurado correctamente." },
        { status: 503 },
      );
    }

    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "AI Chef no devolvió las recetas con el formato esperado. Inténtalo de nuevo." },
        { status: 502 },
      );
    }

    return Response.json(
      {
        error: "No se pudo conectar con el servicio de IA. Inténtalo de nuevo en unos minutos.",
      },
      { status: 503 },
    );
  }
}
