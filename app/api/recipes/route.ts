import {
  getOpenAIModel,
  OpenAIConfigurationError,
  openAIFetch,
} from "../../lib/openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_DESCRIPTION_LENGTH = 12_000;
const MAX_RESTRICTIONS_LENGTH = 1_000;
const MAX_STYLE_LENGTH = 200;
const MAX_PREVIOUS_RECIPE_LENGTH = 500;

const recipeItemSchema = {
  type: "object",
  additionalProperties: false,
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
        additionalProperties: false,
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
        additionalProperties: false,
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
};

const recipeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    introduction: { type: "string" },
    recipes: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: recipeItemSchema,
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

type OpenAIResponse = {
  status?: string;
  error?: { code?: string; message?: string };
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractOutputText(data: OpenAIResponse) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  return (data.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
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
      recipeNumber?: number;
      previousRecipes?: string[];
    };

    const description = boundedText(body.description, MAX_DESCRIPTION_LENGTH);
    const servings = boundedInteger(body.servings, 4, 1, 100);
    const maxTime = boundedInteger(body.maxTime, 45, 10, 180);
    const restrictions = boundedText(body.restrictions, MAX_RESTRICTIONS_LENGTH);
    const style = boundedText(body.style, MAX_STYLE_LENGTH);
    const recipeNumber = boundedInteger(body.recipeNumber, 1, 1, 3);
    const previousRecipes = Array.isArray(body.previousRecipes)
      ? body.previousRecipes
          .slice(0, 2)
          .map((recipe) => boundedText(recipe, MAX_PREVIOUS_RECIPE_LENGTH))
          .filter(Boolean)
      : [];

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
Crear exactamente 1 receta profesional, detallada y realmente ejecutable en una cocina.
Esta es la receta ${recipeNumber} de 3. Debe aprovechar los alimentos disponibles sin sacrificar
la calidad culinaria ni la seguridad alimentaria.

DATOS DE PARTIDA
- Alimentos disponibles: ${description}
- Número exacto de comensales: ${servings}
- Tiempo máximo total por receta: ${maxTime} minutos
- Estilo culinario solicitado: ${style || "cocina sencilla y mediterránea"}
- Restricciones o alergias: ${restrictions || "ninguna indicada"}
${previousRecipes.length > 0 ? `- Recetas ya propuestas que NO debes repetir: ${previousRecipes.join(" | ")}` : ""}

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
- La receta debe utilizar una técnica y una presentación claramente diferentes de las recetas
  ya propuestas, si las hay.
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

    const response = await openAIFetch("responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOpenAIModel(),
        store: false,
        max_output_tokens: 3_500,
        reasoning: {
          effort: "low",
        },
        instructions: `Eres un chef ejecutivo especializado en cocina hotelera, estandarización
de recetas, escandallos, reaprovechamiento y seguridad alimentaria. Redactas recetas precisas,
coherentes y reproducibles por otro equipo de cocina. Compruebas mentalmente cantidades,
raciones, tiempos, temperaturas, alérgenos y correspondencia entre ingredientes y pasos antes
de responder. Priorizas exactitud y viabilidad sobre creatividad. Respondes únicamente con JSON
válido que cumple el esquema solicitado.`,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "circular_chef_recipes",
            strict: true,
            schema: recipeSchema,
          },
        },
      }),
    }, 285_000);

    const responseText = await response.text();
    let data: OpenAIResponse = {};

    try {
      data = JSON.parse(responseText) as OpenAIResponse;
    } catch {
      if (response.ok) throw new SyntaxError("OpenAI devolvió una respuesta no JSON.");
    }

    if (!response.ok) {
      console.error(
        "OpenAI rechazó la generación",
        response.status,
        data.error?.code || "sin código",
      );
      if (response.status === 429) {
        return Response.json(
          { error: "Se ha alcanzado temporalmente el límite de uso de la API. Inténtalo más tarde." },
          { status: 429 },
        );
      }
      return Response.json(
        { error: "El servicio de IA no pudo procesar la solicitud." },
        { status: response.status >= 500 ? 503 : 502 },
      );
    }

    if (data.status === "incomplete") {
      console.error("OpenAI devolvió una respuesta incompleta", data.incomplete_details?.reason);
      return Response.json(
        { error: "La respuesta quedó incompleta. Reduce la entrada e inténtalo de nuevo." },
        { status: 502 },
      );
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      return Response.json({ error: "OpenAI devolvió una respuesta vacía." }, { status: 502 });
    }

    const recipes = normalizeContent(outputText);
    return Response.json(recipes);
  } catch (error) {
    if (error instanceof OpenAIConfigurationError) {
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
