/** Bases de sugerencia configuradas para compras SIIGO. No aplica impuestos. */
export function meetsPurchaseRetentionMinimum(
  retention: { name: string },
  subtotal: number | undefined,
): boolean {
  const name = retention.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bhonorarios?\b/.test(name)) return true;
  if (subtotal === undefined || !Number.isFinite(subtotal) || subtotal < 0) return false;
  if (/\bcompras?\b/.test(name)) return subtotal >= 524000;
  if (/\bservicios?\b/.test(name)) return subtotal >= 105000;
  // Sin un concepto identificable no se infiere la base a partir de la tarifa.
  return false;
}
