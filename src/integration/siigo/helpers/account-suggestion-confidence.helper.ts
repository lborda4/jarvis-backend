import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import { normalizeItemDescription } from '../../helpers/supplier-item-account-mapping.helper';
import {
  extractExampleKeywords,
  similarityScore,
} from './select-historical-examples.helper';

/** Umbral de revisión: <80 = Requiere revisión. */
export const ACCOUNT_CONFIDENCE = {
  /** Descripción exacta confirmada por el contador. */
  EXACT_CONFIRMED: 95,
  /** Factura anterior igual o similar (SIIGO u otra corrección no exacta). */
  SIMILAR_INVOICE: 80,
  /** Solo hay respaldo del balance por tercero. */
  BALANCE_THIRD_PARTY: 55,
  /** Código del catálogo, sin historial comparable. */
  CATALOG: 25,
} as const;

export interface AccountConfidenceHistoryRow {
  descripcionItem: string;
  cuentaPuc: string;
  fuente?: string;
}

/**
 * La confidence de una cuenta sale de la fuente de evidencia, no del
 * modelo. Si hay varias filas para el mismo código, gana la más fuerte.
 */
export function resolveAccountSuggestionConfidence(params: {
  itemDescription: string;
  accountCode: string;
  historicalRows: AccountConfidenceHistoryRow[];
}): number {
  const accountCode = params.accountCode.trim();
  const itemNormalized = normalizeItemDescription(params.itemDescription);
  const itemNormalizedSet = new Set(itemNormalized ? [itemNormalized] : []);
  const itemKeywords = new Set(extractExampleKeywords(params.itemDescription));

  let best: number = ACCOUNT_CONFIDENCE.CATALOG;

  for (const row of params.historicalRows) {
    if (row.cuentaPuc.trim() !== accountCode) {
      continue;
    }

    const exact =
      itemNormalized.length > 0 &&
      normalizeItemDescription(row.descripcionItem) === itemNormalized;
    const similar =
      similarityScore(row.descripcionItem, itemNormalizedSet, itemKeywords) > 0;
    const isBalance = row.fuente === HistorialFacturaFuente.SIIGO_BALANCE_TERCERO;
    const isConfirmed =
      row.fuente === HistorialFacturaFuente.CORREGIDO_CONTADOR;

    if (isConfirmed && exact) {
      return ACCOUNT_CONFIDENCE.EXACT_CONFIRMED;
    }

    if (isBalance) {
      best = Math.max(best, ACCOUNT_CONFIDENCE.BALANCE_THIRD_PARTY);
      continue;
    }

    if (exact || similar) {
      best = Math.max(best, ACCOUNT_CONFIDENCE.SIMILAR_INVOICE);
    }
  }

  return best;
}
