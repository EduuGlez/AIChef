import type { jsPDF as JsPDF } from "jspdf";

type PdfIngredient = {
  name: string;
  amount: number | null;
  unit: string;
  preparation: string;
};

type PdfStep = {
  number: number;
  instruction: string;
  duration_minutes: number;
  temperature: string;
};

export type PdfRecipe = {
  title: string;
  summary: string;
  time_minutes: number;
  prep_time_minutes: number;
  cooking_time_minutes: number;
  difficulty: string;
  servings: number;
  portion_size: string;
  ingredients?: PdfIngredient[];
  uses?: string[];
  extras?: string[];
  steps?: Array<PdfStep | string>;
  waste_tip: string;
  safety_note: string;
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_LIMIT = PAGE_HEIGHT - 18;

function pdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFilename(title: string) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `${slug || "receta"}.pdf`;
}

function normalizeIngredients(recipe: PdfRecipe): PdfIngredient[] {
  return recipe.ingredients ?? [
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
}

function normalizeSteps(recipe: PdfRecipe): PdfStep[] {
  return (recipe.steps ?? []).map((step, index) =>
    typeof step === "string"
      ? { number: index + 1, instruction: step, duration_minutes: 0, temperature: "" }
      : step,
  );
}

export async function createRecipePdf(recipe: PdfRecipe, recipeNumber: number) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = MARGIN;

  const addRunningHeader = (continued = false) => {
    doc.setFillColor(11, 83, 148);
    doc.rect(0, 0, PAGE_WIDTH, 17, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      continued ? `RECETA ${String(recipeNumber).padStart(2, "0")} - CONTINUACIÓN` : `RECETA ${String(recipeNumber).padStart(2, "0")}`,
      PAGE_WIDTH - MARGIN,
      11,
      { align: "right" },
    );
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("CIRCULAR CHEF", MARGIN, 11);
    y = 27;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= FOOTER_LIMIT) return;
    doc.addPage();
    addRunningHeader(true);
  };

  const writeWrapped = (
    text: string,
    options: { size?: number; color?: [number, number, number]; style?: "normal" | "bold" | "italic"; indent?: number; width?: number; lineHeight?: number } = {},
  ) => {
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    const width = options.width ?? CONTENT_WIDTH - indent;
    const lineHeight = options.lineHeight ?? size * 0.42;
    doc.setFont("helvetica", options.style ?? "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(options.color ?? [23, 59, 93]));
    const lines = doc.splitTextToSize(pdfText(text), width) as string[];
    const height = Math.max(lineHeight, lines.length * lineHeight);
    ensureSpace(height);
    doc.setFont("helvetica", options.style ?? "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(options.color ?? [23, 59, 93]));
    doc.text(lines, MARGIN + indent, y, { lineHeightFactor: 1.15 });
    y += height;
  };

  const sectionTitle = (title: string) => {
    ensureSpace(13);
    y += 4;
    doc.setDrawColor(0, 182, 189);
    doc.setLineWidth(0.8);
    doc.line(MARGIN, y, MARGIN + 7, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(11, 83, 148);
    doc.text(title.toUpperCase(), MARGIN + 10, y + 1.3);
    y += 8;
  };

  addRunningHeader();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(23, 59, 93);
  const titleLines = doc.splitTextToSize(pdfText(recipe.title), CONTENT_WIDTH) as string[];
  doc.text(titleLines, MARGIN, y, { lineHeightFactor: 1.08 });
  y += titleLines.length * 8.4 + 2;
  writeWrapped(recipe.summary, { size: 10.5, color: [91, 113, 132], lineHeight: 4.8 });

  y += 4;
  ensureSpace(15);
  doc.setFillColor(238, 248, 250);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 13, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.3);
  doc.setTextColor(11, 83, 148);
  const metadata = [
    `${recipe.time_minutes} min total`,
    `${recipe.prep_time_minutes} min preparación`,
    `${recipe.cooking_time_minutes} min cocción`,
    `${recipe.servings} raciones`,
    pdfText(recipe.difficulty).slice(0, 30),
  ];
  doc.text(metadata.join("   |   "), MARGIN + 5, y + 8);
  y += 15;
  if (recipe.portion_size) {
    writeWrapped(`Tamaño de la ración: ${recipe.portion_size}`, { size: 8.5, color: [91, 113, 132] });
  }

  sectionTitle("Ingredientes y cantidades");
  for (const ingredient of normalizeIngredients(recipe)) {
    const amount = ingredient.amount == null
      ? "Cantidad no indicada"
      : `${ingredient.amount} ${pdfText(ingredient.unit)}`.trim();
    const heading = `${amount}  ${pdfText(ingredient.name)}`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    const headingLines = doc.splitTextToSize(heading, CONTENT_WIDTH - 5) as string[];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const preparationLines = doc.splitTextToSize(pdfText(ingredient.preparation), CONTENT_WIDTH - 5) as string[];
    const itemHeight = headingLines.length * 4 + preparationLines.length * 3.5 + 4;
    ensureSpace(itemHeight);
    doc.setFillColor(107, 172, 0);
    doc.circle(MARGIN + 1.5, y - 1, 1.1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.setTextColor(23, 59, 93);
    doc.text(headingLines, MARGIN + 5, y);
    y += headingLines.length * 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(91, 113, 132);
    doc.text(preparationLines, MARGIN + 5, y);
    y += preparationLines.length * 3.5 + 4;
  }

  sectionTitle("Elaboración paso a paso");
  for (const step of normalizeSteps(recipe)) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    const instructionLines = doc.splitTextToSize(pdfText(step.instruction), CONTENT_WIDTH - 14) as string[];
    const details = [
      step.duration_minutes > 0 ? `${step.duration_minutes} min` : "",
      step.temperature && step.temperature.toLowerCase() !== "no aplica" ? pdfText(step.temperature) : "",
    ].filter(Boolean).join(" | ");
    const itemHeight = instructionLines.length * 4.1 + (details ? 5 : 1) + 5;
    ensureSpace(itemHeight);
    doc.setFillColor(11, 83, 148);
    doc.circle(MARGIN + 4, y + 1, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(String(step.number), MARGIN + 4, y + 2, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    doc.setTextColor(49, 84, 109);
    doc.text(instructionLines, MARGIN + 13, y, { lineHeightFactor: 1.15 });
    y += instructionLines.length * 4.1;
    if (details) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(0, 140, 148);
      doc.text(details.toUpperCase(), MARGIN + 13, y + 1);
      y += 5;
    }
    y += 5;
  }

  sectionTitle("Consejo circular");
  writeWrapped(recipe.waste_tip, { size: 9.2, color: [71, 103, 43], lineHeight: 4.2 });

  if (recipe.safety_note) {
    sectionTitle("Control APPCC");
    writeWrapped(recipe.safety_note, { size: 9.2, color: [138, 63, 40], lineHeight: 4.2 });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(213, 227, 234);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_HEIGHT - 13, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(91, 113, 132);
    doc.text("Revisa la receta con el responsable de cocina y el sistema APPCC.", MARGIN, PAGE_HEIGHT - 8);
    doc.text(`${page} / ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, { align: "right" });
  }

  return doc;
}

export async function downloadRecipePdf(recipe: PdfRecipe, recipeNumber: number) {
  const doc: JsPDF = await createRecipePdf(recipe, recipeNumber);
  doc.save(safeFilename(recipe.title));
}
