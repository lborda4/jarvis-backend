/** Códigos más usados de la tabla DIAN 13.3.4.2 (medios de pago). */
const DIAN_PAYMENT_METHOD_NAME: Record<string, string> = {
  '1': 'Instrumento no definido',
  '10': 'Efectivo',
  '20': 'Cheque',
  '30': 'Transferencia crédito bancario',
  '31': 'Transferencia débito bancario',
  '42': 'Transferencia crédito bancario',
  '45': 'Transferencia crédito bancario',
  '46': 'Transferencia débito interbancario',
  '47': 'Transferencia débito bancario',
  '48': 'Tarjeta crédito',
  '49': 'Tarjeta débito',
  '71': 'Bonos',
  ZZ: 'Otro',
};

export function resolveDianPaymentMethodName(
  code: string | number | null | undefined,
): string | null {
  const normalized = String(code ?? '').trim();

  if (!normalized) {
    return null;
  }

  return DIAN_PAYMENT_METHOD_NAME[normalized] ?? `Código ${normalized}`;
}
