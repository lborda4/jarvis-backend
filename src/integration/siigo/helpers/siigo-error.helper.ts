import { BadGatewayException, Logger } from '@nestjs/common';

export function handleSiigoApiError(
  logger: Logger,
  error: unknown,
  action: string,
): never {
  const rawMessage =
    error instanceof Error
      ? error.message
      : `Error desconocido al ${action} en SIIGO`;

  const parsedDetail = parseSiigoErrorDetail(rawMessage);

  logger.error(
    `Error al ${action} en SIIGO: ${formatSiigoErrorMessage(parsedDetail)}`,
    error instanceof Error ? error.stack : String(error),
  );

  throw new BadGatewayException({
    message: `Error al ${action} en SIIGO`,
    code: extractSiigoErrorCode(parsedDetail),
    siigo: parsedDetail,
    detail: formatSiigoErrorMessage(parsedDetail),
  });
}

/** Detecta si una excepción YA envuelta por `handleSiigoApiError` (ej. la
 * que llega al catch de un caller, después de agotar reintentos) vino de
 * un 503/document_query_service de SIIGO — para mostrarle al usuario que
 * el servicio de SIIGO está caído en vez de un error genérico. */
export function isSiigoServiceUnavailableApiError(error: unknown): boolean {
  if (!(error instanceof BadGatewayException)) {
    return false;
  }

  const body = error.getResponse();

  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const detail =
    typeof record.detail === 'string' ? record.detail.toLowerCase() : '';

  return (
    code === 'document_query_service' ||
    detail.includes('estado 503') ||
    detail.includes('"status":503')
  );
}

/** Detecta si una excepción YA envuelta por `handleSiigoApiError` vino de
 * `invalid_total_payments` — SIIGO recalcula el total de la compra con su
 * propia lógica de redondeo (a veces enteros, a veces con centavos según el
 * caso, ver siigo-purchase-total.helper.ts) y rechaza el pago si no coincide
 * EXACTO con lo que ella calculó. En vez de adivinar su redondeo de
 * antemano, se detecta este error puntual para reintentar una vez con el
 * total exacto que SIIGO ya nos dio en el mensaje (ver
 * extractSiigoCalculatedTotalFromApiError). */
export function isSiigoInvalidTotalPaymentsApiError(error: unknown): boolean {
  if (!(error instanceof BadGatewayException)) {
    return false;
  }

  const body = error.getResponse();

  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const detail =
    typeof record.detail === 'string' ? record.detail.toLowerCase() : '';

  return (
    code === 'invalid_total_payments' ||
    detail.includes('invalid_total_payments')
  );
}

/** Extrae el número de "The total purchase calculated is X" del mensaje de
 * error de SIIGO — el total exacto (con o sin centavos, lo que SIIGO haya
 * decidido para ESTA factura puntual) que espera en `payments[].value`. */
export function extractSiigoCalculatedTotalFromApiError(
  error: unknown,
): number | null {
  if (!(error instanceof BadGatewayException)) {
    return null;
  }

  const body = error.getResponse();

  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const detail = (body as Record<string, unknown>).detail;

  if (typeof detail !== 'string') {
    return null;
  }

  const match = detail.match(/total purchase calculated is\s*([\d.]+)/i);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);

  return Number.isFinite(value) ? value : null;
}

function extractSiigoErrorCode(
  parsedDetail: string | Record<string, unknown>,
): string | undefined {
  if (typeof parsedDetail !== 'object' || parsedDetail === null) {
    return undefined;
  }

  const errors = parsedDetail.Errors ?? parsedDetail.errors;

  if (!Array.isArray(errors) || errors.length === 0) {
    return undefined;
  }

  const firstError = errors[0] as Record<string, unknown> | undefined;
  const code = firstError?.Code ?? firstError?.code;

  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
}

function formatSiigoErrorMessage(
  parsedDetail: string | Record<string, unknown>,
): string {
  if (typeof parsedDetail === 'string') {
    return parsedDetail;
  }

  return JSON.stringify(parsedDetail);
}

function parseSiigoErrorDetail(
  message: string,
): string | Record<string, unknown> {
  const jsonStart = message.indexOf('{');

  if (jsonStart === -1) {
    return message;
  }

  try {
    return JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
  } catch {
    return message;
  }
}
