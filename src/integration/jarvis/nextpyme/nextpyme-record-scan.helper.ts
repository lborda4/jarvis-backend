export type UnknownRecord = Record<string, unknown>;

/**
 * Recorre un payload JSON de forma - típicamente la respuesta de un
 * endpoint de NextPyme sin schema fijo - y devuelve todos los objetos
 * (records) anidados que encuentra, sin importar la profundidad.
 *
 * Con `parseJsonStrings: true` también intenta parsear valores string que
 * parecen JSON embebido (algunas respuestas de NextPyme traen campos
 * anidados como texto en vez de objeto).
 */
export function collectRecords(
  value: unknown,
  options: { parseJsonStrings?: boolean } = {},
): UnknownRecord[] {
  const records: UnknownRecord[] = [];
  const pending: unknown[] = [value];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.shift();

    if (options.parseJsonStrings && typeof current === 'string') {
      const trimmed = current.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          pending.push(JSON.parse(trimmed));
        } catch {
          // El valor es texto normal, no JSON anidado.
        }
      }
      continue;
    }

    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    const record = current as UnknownRecord;
    records.push(record);
    pending.push(...Object.values(record));
  }

  return records;
}

/**
 * Normaliza una clave de objeto para compararla sin acentos, mayúsculas ni
 * separadores (ej. "Número Identificación" -> "numeroidentificacion").
 */
export function normalizeRecordKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/**
 * Devuelve `value` como string recortado si es un string/number no vacío y
 * distinto de "null" (case-insensitive), o null en cualquier otro caso.
 */
export function normalizeRecordValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized && normalized.toLowerCase() !== 'null' ? normalized : null;
}

/**
 * Busca en `record` la primera propiedad cuya clave normalizada matchee
 * alguno de `candidateKeys` (ya se pasen normalizados o no) y devuelva un
 * valor string/number no vacío.
 */
export function findInRecord(
  record: UnknownRecord,
  candidateKeys: string[],
): string | null {
  const candidates = new Set(candidateKeys.map(normalizeRecordKey));

  for (const [key, value] of Object.entries(record)) {
    if (!candidates.has(normalizeRecordKey(key))) {
      continue;
    }

    const normalizedValue = normalizeRecordValue(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return null;
}
