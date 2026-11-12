import type { NextPymeApiClient } from '../nextpyme/nextpyme-api.client';

export async function checkInvoiceNoteEligibility(client: Pick<NextPymeApiClient, 'getInvoiceRadianStatus'>, cufe: string, token: string) {
  const result = await client.getInvoiceRadianStatus(cufe, token);
  return {
    source: 'nextpyme' as const,
    allowed: !result.accepted,
    blockReason: result.accepted
      ? 'Esta factura ya tiene aceptación en RADIAN. No se le puede hacer nota crédito ni nota débito.'
      : null,
  };
}
