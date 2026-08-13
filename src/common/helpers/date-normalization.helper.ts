const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})/;
const DAY_MONTH_YEAR_PATTERN =
  /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
const DAY_MONTH_YEAR_WITH_DOT_PATTERN =
  /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * Devuelve la fecha ISO (yyyy-mm-dd) si `value` ya es una fecha ISO exacta
 * o empieza por una, o null si no matchea.
 */
export function matchIsoDate(value: string): string | null {
  if (ISO_DATE_PATTERN.test(value)) {
    return value;
  }

  const match = value.match(ISO_DATE_PREFIX_PATTERN);
  return match ? match[1] : null;
}

/**
 * Convierte dd/mm/aaaa (o dd-mm-aaaa, opcionalmente con hora) a yyyy-mm-dd.
 * Devuelve null si `value` no matchea ese formato.
 */
export function convertDayMonthYearToIso(
  value: string,
  options: { allowDotSeparator?: boolean } = {},
): string | null {
  const pattern = options.allowDotSeparator
    ? DAY_MONTH_YEAR_WITH_DOT_PATTERN
    : DAY_MONTH_YEAR_PATTERN;

  const match = value.match(pattern);

  if (!match) {
    return null;
  }

  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  return `${year}-${month}-${day}`;
}
