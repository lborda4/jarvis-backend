/** Bases de sugerencia configuradas para compras SIIGO. No aplica impuestos. */
export function meetsPurchaseRetentionMinimum(
  retention: { name: string; type?: string },
  subtotal: number | undefined,
  historicalConcept?: string,
): boolean {
  const name = retention.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const type = retention.type?.toLowerCase().replace(/[^a-z]/g, '');
  if (type === 'reteica') {
    if (subtotal === undefined || !Number.isFinite(subtotal) || subtotal < 0) return false;
    // El nombre de ReteICA puede contener solo ciudad y tarifa. En ese caso
    // usar el concepto de Retefuente consistente del mismo proveedor.
    const concept = /\b(compras?|servicios?|honorarios?)\b/.test(name)
      ? name : (historicalConcept ?? '').toLowerCase();
    const purchases = /\bcompras?\b/.test(concept);
    const services = /\bservicios?\b/.test(concept);
    if (purchases === services || /\bhonorarios?\b/.test(concept)) return false;
    return subtotal >= (purchases ? 1414098 : 209496);
  }
  if (/\bhonorarios?\b/.test(name)) return true;
  if (subtotal === undefined || !Number.isFinite(subtotal) || subtotal < 0) return false;
  if (/\bcompras?\b/.test(name)) return subtotal >= 524000;
  if (/\bservicios?\b/.test(name)) return subtotal >= 105000;
  // Sin un concepto identificable no se infiere la base a partir de la tarifa.
  return false;
}
