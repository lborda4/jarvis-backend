export const ELECTRONIC_DOCUMENT_PAGE_SIZE_OPTIONS = [10, 50, 100] as const;

export type ElectronicDocumentPageSize =
  (typeof ELECTRONIC_DOCUMENT_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_ELECTRONIC_DOCUMENT_PAGE_SIZE = 10;

export function normalizeElectronicDocumentPageLimit(
  value?: number | string | null,
): ElectronicDocumentPageSize {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (
    ELECTRONIC_DOCUMENT_PAGE_SIZE_OPTIONS.includes(
      parsed as ElectronicDocumentPageSize,
    )
  ) {
    return parsed as ElectronicDocumentPageSize;
  }

  return DEFAULT_ELECTRONIC_DOCUMENT_PAGE_SIZE;
}
