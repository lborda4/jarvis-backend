import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import { normalizeItemDescription } from '../../helpers/supplier-item-account-mapping.helper';

/** Facturas distintas a consultar para armar el pool de ejemplos. */
export const HISTORICAL_EXAMPLE_INVOICE_LIMIT = 10;
/** Máximo de líneas que se mandan en el prompt. */
export const HISTORICAL_EXAMPLE_LINE_LIMIT = 10;
/** Una factura larga no puede ocupar todo el contexto. */
export const MAX_HISTORICAL_EXAMPLES_PER_INVOICE = 3;
const MIN_KEYWORD_LENGTH = 4;

export interface HistoricalExampleCandidate {
  descripcionItem: string;
  facturaId?: string;
  fechaFactura?: string;
  fuente?: string;
}

export function extractExampleKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9áéíóúñ]+/i)
        .filter((word) => word.length >= MIN_KEYWORD_LENGTH),
    ),
  ];
}

export function similarityScore(
  exampleDescription: string,
  itemNormalized: Set<string>,
  itemKeywords: Set<string>,
): number {
  const normalized = normalizeItemDescription(exampleDescription);

  if (!normalized) {
    return 0;
  }

  if (itemNormalized.has(normalized)) {
    return 1000;
  }

  for (const item of itemNormalized) {
    if (
      item.length >= 8 &&
      (normalized.includes(item) || item.includes(normalized))
    ) {
      return 500;
    }
  }

  const overlap = extractExampleKeywords(exampleDescription).filter((keyword) =>
    itemKeywords.has(keyword),
  ).length;

  return overlap > 0 ? overlap * 10 : 0;
}

/**
 * Elige hasta `limit` líneas históricas comparables con los ítems actuales.
 * Descarta las que no se parecen, no deja que una factura ocupe todo el
 * cupo y, a igualdad de similitud, prefiere la corrección del contador y
 * después la más reciente.
 */
export function selectHistoricalExamplesForPrompt<
  T extends HistoricalExampleCandidate,
>(
  itemDescriptions: string[],
  rows: T[],
  limit = HISTORICAL_EXAMPLE_LINE_LIMIT,
): T[] {
  const itemNormalized = new Set(
    itemDescriptions.map(normalizeItemDescription).filter(Boolean),
  );
  const itemKeywords = new Set(itemDescriptions.flatMap(extractExampleKeywords));

  const scored = rows
    .map((row, index) => ({
      row,
      index,
      score: similarityScore(
        row.descripcionItem,
        itemNormalized,
        itemKeywords,
      ),
      normalized: normalizeItemDescription(row.descripcionItem),
    }))
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const aCorrected =
      a.row.fuente === HistorialFacturaFuente.CORREGIDO_CONTADOR ? 0 : 1;
    const bCorrected =
      b.row.fuente === HistorialFacturaFuente.CORREGIDO_CONTADOR ? 0 : 1;

    if (aCorrected !== bCorrected) {
      return aCorrected - bCorrected;
    }

    const aDate = a.row.fechaFactura ?? '';
    const bDate = b.row.fechaFactura ?? '';

    if (aDate !== bDate) {
      return bDate.localeCompare(aDate);
    }

    return a.index - b.index;
  });

  const selected: T[] = [];
  const seenDescriptions = new Set<string>();
  const linesPerInvoice = new Map<string, number>();

  for (const entry of scored) {
    if (selected.length >= limit) {
      break;
    }

    if (entry.normalized && seenDescriptions.has(entry.normalized)) {
      continue;
    }

    const invoiceId = entry.row.facturaId;

    if (invoiceId) {
      const used = linesPerInvoice.get(invoiceId) ?? 0;

      if (used >= MAX_HISTORICAL_EXAMPLES_PER_INVOICE) {
        continue;
      }

      linesPerInvoice.set(invoiceId, used + 1);
    }

    if (entry.normalized) {
      seenDescriptions.add(entry.normalized);
    }

    selected.push(entry.row);
  }

  return selected;
}
