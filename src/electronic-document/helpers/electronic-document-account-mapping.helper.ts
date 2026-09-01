import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import { normalizeItemDescription } from '../../integration/helpers/supplier-item-account-mapping.helper';

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

/** Igual que applyAccountMappingToPayload, pero cada ítem toma SU PROPIA
 * cuenta según su descripción (normalizada) en vez de la misma para todos
 * — usada cuando el contador confirma cuentas distintas para conceptos
 * distintos de un mismo documento. Un ítem cuya descripción no aparece en
 * `accountByDescription` conserva el `accountMapping` que ya tuviera. */
export function applyPerItemAccountMappingToPayload(
  payload: ElectronicDocumentPayload,
  accountByDescription: Map<string, { code: string; description?: string }>,
): ElectronicDocumentPayload {
  return {
    ...payload,
    items: payload.items.map((item) => {
      const mapping = accountByDescription.get(
        normalizeItemDescription(item.descripcion),
      );

      if (!mapping) {
        return item;
      }

      const trimmedDescription = mapping.description?.trim();

      return {
        ...item,
        accountMapping: {
          code: mapping.code.trim(),
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
        },
      };
    }),
  };
}
