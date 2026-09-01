/**
 * El companyId va embebido en el nombre de la room como defensa adicional
 * (aunque el chequeo de tenant real ya ocurre en subscribe_job vía
 * PurchaseInvoiceImportStatusService, igual que en el endpoint REST) — así
 * un cliente nunca puede terminar en la room de un job de otra empresa aun
 * si hubiera un bug en el handler de suscripción.
 */
export function buildPurchaseInvoiceImportJobRoom(
  companyId: string,
  jobId: string,
): string {
  return `pii-job:${companyId}:${jobId}`;
}
