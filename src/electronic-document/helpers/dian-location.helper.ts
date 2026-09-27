const COUNTRY_NAME_BY_CODE: Record<string, string> = {
  CO: 'Colombia',
  COL: 'Colombia',
  '169': 'Colombia',
};

export function resolveCountryName(
  code: string | null | undefined,
): string | null {
  const normalized = code?.trim();

  if (!normalized) {
    return null;
  }

  return (
    COUNTRY_NAME_BY_CODE[normalized.toUpperCase()] ??
    (normalized.length > 3 ? normalized : null)
  );
}
