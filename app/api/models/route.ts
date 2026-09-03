import { getOllamaModel, ollamaFetch } from "../../lib/ollama";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  try {
    const response = await ollamaFetch("api/tags", {}, 7_000);
    if (!response.ok) throw new Error("Ollama no respondió correctamente");

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const model = getOllamaModel();
    const available = (data.models || []).some((item) => item.name === model);

    if (!available) {
      return Response.json(
        { error: `El modelo ${model} no está instalado.`, online: false },
        { status: 503 },
      );
    }

    return Response.json({ online: true });
  } catch {
    return Response.json(
      { error: "No se pudo conectar con el servicio de IA", online: false },
      { status: 503 },
    );
  }
}
