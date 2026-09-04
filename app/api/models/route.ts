import {
  getOpenAIModel,
  OpenAIConfigurationError,
  openAIFetch,
} from "../../lib/openai";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  try {
    const model = getOpenAIModel();
    const response = await openAIFetch(`models/${encodeURIComponent(model)}`, {}, 10_000);
    if (!response.ok) {
      console.error("OpenAI rechazó la comprobación del modelo", response.status);
      return Response.json(
        { error: "No se pudo validar la configuración de OpenAI.", online: false },
        { status: 503 },
      );
    }

    return Response.json({ online: true });
  } catch (error) {
    if (error instanceof OpenAIConfigurationError) console.error(error.message);
    return Response.json(
      { error: "No se pudo conectar con OpenAI.", online: false },
      { status: 503 },
    );
  }
}
