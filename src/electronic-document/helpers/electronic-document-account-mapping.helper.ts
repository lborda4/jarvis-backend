import { resolveItemAiSuggestion } from './electronic-document-ai-suggestion.helper';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import { normalizeItemDescription } from '../../integration/helpers/supplier-item-account-mapping.helper';

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
  const { aiSuggestion: _legacySuggestion, ...rest } = payload;
  return {
    ...rest,
    items: payload.items.map((item, index) => {
      // A document-wide answer is only unambiguous for a single item.
      const suggestion =
        classification.items?.[index] ??
        (classification.items === undefined && payload.items.length === 1
          ? classification
          : undefined);
      const previous = resolveItemAiSuggestion(payload, index);
      if (
        !suggestion?.accountCode &&
        !suggestion?.productCode &&
        (previous?.account?.code || previous?.product?.code)
      ) {
        return { ...item, aiSuggestion: previous };
      }
      return {
        ...item,
        ...(classification.itemType
          ? { itemType: classification.itemType }
          : {}),
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
          confidence:
            suggestion?.accountCode || suggestion?.productCode
              ? (suggestion.confidence ?? 0)
              : 0,
        },
      };
    }),
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
