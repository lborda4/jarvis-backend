/** Convierte un candidato de un `Record<string, unknown>` a string SOLO si
 * ya es string/number — nunca `String(objeto)`, que degradaría en
 * "[object Object]" si el campo cambia de forma en una respuesta futura. */
function stringifyCandidate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Parseo de la respuesta de NextPyme al crear un documento (Documento
 * Soporte, Factura de venta) — compartido entre JarvisSupportDocumentSendService
 * y JarvisInvoiceSendService porque NextPyme devuelve la misma familia de
 * campos (id/uuid, number, consecutive, cude/cufe) para ambos tipos de
 * documento, sin un shape fijo documentado.
 */
export function readNextPymeCreatedId(
  payload: Record<string, unknown>,
  fallbackPrefix: string,
  fallbackNumber: number,
): string {
  const candidates = [
    payload.uuid,
    payload.cufe,
    payload.cude,
    payload.cuds,
    payload.id,
    (payload.data as Record<string, unknown> | undefined)?.uuid,
    (payload.data as Record<string, unknown> | undefined)?.cufe,
    (payload.data as Record<string, unknown> | undefined)?.cude,
    (payload.data as Record<string, unknown> | undefined)?.id,
  ];

  for (const candidate of candidates) {
    const value = stringifyCandidate(candidate);
    if (value) {
      return value;
    }
  }

  return `NP-${fallbackPrefix}-${fallbackNumber}`;
}

export function readNextPymeCreatedNumber(
  payload: Record<string, unknown>,
  fallbackNumber: number,
  consecutive?: string | null,
): number {
  const candidates = [
    payload.number,
    (payload.data as Record<string, unknown> | undefined)?.number,
    (payload.resolution as Record<string, unknown> | undefined)?.number,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (consecutive) {
    const digits = consecutive.match(/(\d+)\s*$/)?.[1];
    const parsed = digits ? Number(digits) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallbackNumber;
}

export function readNextPymeCreatedConsecutive(
  payload: Record<string, unknown>,
  prefix: string,
  fallbackNumber: number,
): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const message = typeof payload.message === 'string' ? payload.message : '';
  const messageMatch = message.match(/#\s*([A-Za-z0-9_-]+)/);

  if (messageMatch?.[1]) {
    return messageMatch[1].trim().toUpperCase();
  }

  const nested = [
    payload.next_consecutive,
    payload.consecutive,
    (payload.data as Record<string, unknown> | undefined)?.next_consecutive,
    (payload.data as Record<string, unknown> | undefined)?.consecutive,
    (payload.resolution as Record<string, unknown> | undefined)
      ?.next_consecutive,
  ];

  for (const candidate of nested) {
    const value = stringifyCandidate(candidate);
    if (value) {
      return value.toUpperCase();
    }
  }

  const number = readNextPymeCreatedNumber(payload, fallbackNumber);
  return `${normalizedPrefix}${number}`;
}

/** `cude` (Documento Soporte) o `cufe` (Factura de venta) — el código único
 * que la DIAN asigna al documento. */
export function readNextPymeCreatedUniqueCode(
  payload: Record<string, unknown>,
): string | null {
  const candidates = [
    payload.cufe,
    payload.cude,
    payload.cuds,
    (payload.data as Record<string, unknown> | undefined)?.cufe,
    (payload.data as Record<string, unknown> | undefined)?.cude,
    (payload.data as Record<string, unknown> | undefined)?.cuds,
  ];

  for (const candidate of candidates) {
    const value = stringifyCandidate(candidate);
    if (value) {
      return value;
    }
  }

  return null;
}

export function toMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number): string {
  return toMoney(value).toFixed(2);
}

export function daysBetweenLocalDates(
  fromDate: string,
  toDate: string,
): number {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}
