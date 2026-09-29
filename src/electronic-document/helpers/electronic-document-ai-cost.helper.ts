import type { AiSuggestionSnapshot } from '../interfaces/electronic-document-payload.interface';

/** Retiene únicamente los costos al retirar una sugerencia global antigua. */
export function readAiCost(suggestion?: AiSuggestionSnapshot | null) {
  if (!suggestion?.costsByRequest) return undefined;
  return {
    totalCost: suggestion.totalCost,
    currency: 'USD' as const,
    costsByRequest: suggestion.costsByRequest,
  };
}

export function addAiRequestCost(
  suggestion: AiSuggestionSnapshot | null | undefined,
  requestId: string,
  cost: number,
): AiSuggestionSnapshot {
  const costsByRequest = { ...suggestion?.costsByRequest, [requestId]: cost };
  return {
    ...suggestion,
    retentions: suggestion?.retentions ?? [],
    currency: 'USD',
    // Mantener la precisión de cargos pequeños; no redondear a centavos.
    totalCost: Number(Object.values(costsByRequest).reduce((sum, value) => sum + value, 0).toFixed(12)),
    costsByRequest,
  };
}
