import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

export function applyAccountMappingToPayload(
  payload: ElectronicDocumentPayload,
  accountCode: string,
  accountDescription?: string,
): ElectronicDocumentPayload {
  const trimmedCode = accountCode.trim();
  const trimmedDescription = accountDescription?.trim();

  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      accountMapping: {
        code: trimmedCode,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      },
    })),
  };
}
