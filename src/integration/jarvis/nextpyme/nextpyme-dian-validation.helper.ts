import {
  collectRecords,
  normalizeRecordKey,
  normalizeRecordValue,
  UnknownRecord,
} from './nextpyme-record-scan.helper';

export interface DianValidationResult {
  /** `null` cuando el resultado de validación de la DIAN no vino en la
   * respuesta (no se pudo encontrar el campo `IsValid` en ningún objeto
   * anidado) — en ese caso no hay nada que bloquear, ver
   * parseDianValidationResult. */
  isValid: boolean | null;
  statusCode: string | null;
  statusDescription: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
}

function getByNormalizedKey(record: UnknownRecord, key: string): unknown {
  const target = normalizeRecordKey(key);

  return Object.entries(record).find(
    ([candidate]) => normalizeRecordKey(candidate) === target,
  )?.[1];
}

function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return null;
}

/** `ErrorMessage` viene como `{ string: "..." }` o `{ string: ["...", "..."] }`
 * — resabio de convertir la respuesta SOAP/XML de la DIAN a JSON (un array
 * de un solo elemento se colapsa a objeto, varios quedan como array). */
function extractErrorMessageText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (value && typeof value === 'object') {
    const inner = (value as UnknownRecord).string;

    if (typeof inner === 'string') {
      return inner.trim() || null;
    }

    if (Array.isArray(inner)) {
      const joined = inner
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
        .join(' | ');

      return joined || null;
    }
  }

  return null;
}

/**
 * NextPyme responde HTTP 200 con `success: true` incluso cuando la DIAN
 * RECHAZÓ el documento — el resultado real de la validación viaja anidado
 * en `ResponseDian` (la respuesta cruda del webservice SOAP de la DIAN,
 * convertida a JSON) en un objeto tipo `SendBillSyncResult`, con `IsValid`
 * (string "true"/"false", no boolean), `ErrorMessage`, `StatusDescription`.
 * Nunca basta con mirar `success`/`message` de NextPyme para saber si el
 * documento quedó realmente aceptado — caso real reportado: `success: true`,
 * `message` con el nombre del AttachedDocument generado, pero
 * `IsValid: "false"` con "Rechazo: Documento procesado anteriormente".
 *
 * Se busca por deep-scan (no por una ruta fija Envelope.Body...) porque el
 * nombre de la acción SOAP intermedia (SendBillSyncResponse,
 * SendTestSetAsyncResponse, etc.) varía según tipo de documento/ambiente —
 * lo estable es que el resultado siempre trae `IsValid` junto al resto de
 * estos campos en el mismo objeto.
 */
export function parseDianValidationResult(
  response: unknown,
): DianValidationResult | null {
  const records = collectRecords(response, { parseJsonStrings: true });
  const resultRecord = records.find(
    (record) => getByNormalizedKey(record, 'IsValid') !== undefined,
  );

  if (!resultRecord) {
    return null;
  }

  return {
    isValid: parseBooleanish(getByNormalizedKey(resultRecord, 'IsValid')),
    statusCode: normalizeRecordValue(
      getByNormalizedKey(resultRecord, 'StatusCode'),
    ),
    statusDescription: normalizeRecordValue(
      getByNormalizedKey(resultRecord, 'StatusDescription'),
    ),
    statusMessage: normalizeRecordValue(
      getByNormalizedKey(resultRecord, 'StatusMessage'),
    ),
    errorMessage: extractErrorMessageText(
      getByNormalizedKey(resultRecord, 'ErrorMessage'),
    ),
  };
}
