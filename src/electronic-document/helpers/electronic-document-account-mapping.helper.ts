import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import { ElectronicDocumentItem } from '../interfaces/electronic-document-item.interface';
import { normalizeItemDescription } from '../../integration/helpers/supplier-item-account-mapping.helper';

export interface AiClassificationForPayloadItems {
  itemType: 'Account' | 'Product' | null;
  items: Array<{
    accountCode: string | null;
    accountName: string | null;
    productCode?: string | null;
  }>;
}

/** Escribe en CADA línea del payload la cuenta (o tipo Producto) que eligió
 * la clasificación automática — no deja la sugerencia solo en
 * aiSuggestion.account a nivel documento. No pisa un accountMapping que el
 * contador ya hubiera guardado. */
export function applyAiClassificationToPayloadItems(
  items: ElectronicDocumentItem[],
  classification: AiClassificationForPayloadItems,
): ElectronicDocumentItem[] {
  return items.map((item, index) => {
    const classified = classification.items[index];
    const itemType = classification.itemType ?? undefined;

    if (itemType === 'Account' && classified?.accountCode?.trim()) {
      if (item.accountMapping?.code?.trim()) {
        return { ...item, itemType: 'Account' };
      }

      return {
        ...item,
        itemType: 'Account',
        accountMapping: {
          code: classified.accountCode.trim(),
          description:
            classified.accountName?.trim() || classified.accountCode.trim(),
        },
      };
    }

    if (itemType === 'Product') {
      return {
        ...item,
        itemType: 'Product',
      };
    }

    return item;
  });
}

export function applyItemClassificationToPayload(
  payload: ElectronicDocumentPayload,
  classification: {
    itemType: 'Account' | 'Product' | null;
    accountCode: string | null;
    accountName: string | null;
    productCode: string | null;
    productName: string | null;
    confidence: number | null;
    items?: Array<{
      accountCode: string | null;
      accountName: string | null;
      productCode: string | null;
      productName: string | null;
      confidence: number | null;
    }>;
  },
): ElectronicDocumentPayload {
  const classifiedItems = classification.items ?? [];
  const foundNothing =
    !classification.accountCode &&
    !classification.productCode &&
    !classifiedItems.some((item) => item.accountCode || item.productCode);

  return {
    ...payload,
    items: applyAiClassificationToPayloadItems(payload.items ?? [], {
      itemType: classification.itemType,
      items: classifiedItems,
    }).map((item, index) => {
      const suggestion = classifiedItems[index];
      return {
        ...item,
        aiSuggestion: {
          account: suggestion?.accountCode
            ? {
                code: suggestion.accountCode,
                name: suggestion.accountName ?? suggestion.accountCode,
              }
            : null,
          product: suggestion?.productCode
            ? {
                code: suggestion.productCode,
                name: suggestion.productName ?? suggestion.productCode,
              }
            : null,
          confidence: suggestion?.confidence ?? 0,
        },
      };
    }),
    aiSuggestion: {
      itemType: classification.itemType,
      account: classification.accountCode
        ? {
            code: classification.accountCode,
            name: classification.accountName ?? classification.accountCode,
          }
        : null,
      product: classification.productCode
        ? {
            code: classification.productCode,
            name: classification.productName ?? classification.productCode,
          }
        : null,
      retentions: [],
      confidence:
        foundNothing || classification.confidence == null
          ? 0
          : classification.confidence,
    },
  };
}

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
