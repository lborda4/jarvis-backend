import { ElectronicDocumentDraft } from '../interfaces/electronic-document-draft.interface';
import { ElectronicDocumentItem } from '../interfaces/electronic-document-item.interface';
import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SuggestedItemAccount,
  SuggestedProduct,
  SuggestedPurchaseItemConfig,
} from '../../integration/helpers/supplier-preference.helper';

/**
 * Puerto al backend de needsPurchaseInvoiceReview (ver
 * src/utils/supportDocumentSend.ts en el frontend) — antes esto se
 * recalculaba en cada render a partir del estado del EDITOR (rowItems/
 * rowAccounts/rowPaymentMethods, todavía sin guardar), así que "Requiere
 * revisión" solo se conocía para los documentos de la página cargada y el
 * filtro de Estado no podía buscar en el resto.
 *
 * Ahora se computa acá, a partir de lo último GUARDADO: el borrador
 * (electronic_documents.draft) si el contador ya guardó algo, o si no las
 * sugerencias de siempre (historial del proveedor / IA). "Guardar cambios"
 * es lo que hace que el documento deje de requerir revisión — mientras se
 * está escribiendo, sigue viéndose "Requiere revisión" hasta que se guarda.
 *
 * Diferencia deliberada con la versión de frontend: ACÁ NO se valida el
 * código de cuenta/producto contra el catálogo vigente de SIIGO (eso solo
 * pasa en el navegador, ver resolveValidatedAccountCode/
 * resolveValidatedProductCode) — se confía en que un código ya sugerido o
 * guardado es válido. Si una cuenta se elimina del catálogo DESPUÉS de
 * haber sido sugerida o guardada, este cálculo no lo detecta (el frontend
 * sí, al re-renderizar con el catálogo fresco). Caso raro y aceptado por
 * ahora: hacerlo acá exigiría cargar el catálogo completo de cuentas y
 * productos en cada listado.
 */
const AI_CONFIDENCE_REVIEW_THRESHOLD = 80;

export interface PurchaseInvoiceReviewInput {
  draft: ElectronicDocumentDraft | null;
  payloadItems: ElectronicDocumentItem[];
  suggestedAccount: SuggestedAccount | null;
  suggestedProduct: SuggestedProduct | null;
  suggestedItemConfig: SuggestedPurchaseItemConfig | null;
  itemAccountSuggestions: Array<SuggestedItemAccount | null>;
  itemProductSuggestions?: Array<SuggestedProduct | null>;
  aiConfidence: number | null;
  /** true si ya existe `payload.aiSuggestion`: la clasificación corrió
   * (o quedó a medias). En ese caso `confidence` null se trata como
   * fallo (<80): un fallback de historial no puede dejar el documento
   * en Pendiente. Sin este flag, null sigue significando "la IA nunca
   * corrió" y no dispara la regla. */
  aiClassificationAttempted?: boolean;
}

interface EffectiveItem {
  tipo: 'Account' | 'Product' | 'FixedAsset';
  hasCode: boolean;
}

function resolveEffectiveItems(input: PurchaseInvoiceReviewInput): EffectiveItem[] {
  if (input.draft?.items?.length) {
    return input.draft.items.map((item) => ({
      tipo: item.tipo,
      hasCode: Boolean(item.producto?.trim()),
    }));
  }

  const effectiveItemType = input.suggestedItemConfig?.itemType ?? 'Account';

  return input.payloadItems.map((_item, index) => {
    // Misma prioridad que buildPurchaseInvoiceItemDrafts en el frontend: una
    // regla exacta de ESTE ítem (proveedor + descripción) manda sobre el
    // tipo dominante del proveedor completo.
    const exactItemAccount = input.itemAccountSuggestions[index];
    const hasExactItemAccountRule = exactItemAccount?.source === 'exact';
    const tipo: EffectiveItem['tipo'] = hasExactItemAccountRule
      ? 'Account'
      : effectiveItemType;

    if (tipo === 'Product') {
      // item.codigo (el código que trae la factura DIAN) NO cuenta acá: es
      // SIEMPRE un identificador del VENDEDOR (su SKU o código de barras),
      // nunca un código de producto real de SIIGO — el frontend solo lo usa
      // como candidato cuando coincide LITERALMENTE con el catálogo
      // (resolveValidatedProductCode); acá, sin catálogo cargado, no hay
      // forma de validarlo, así que confiar en él a ciegas marcaba "Pendiente"
      // ítems que en realidad estaban sin producto real asignado (bug real
      // reportado: un ítem con "Buscar producto..." vacío en el editor
      // seguía en Pendiente en vez de Requiere revisión). Solo cuentan
      // suggestedItemConfig/suggestedProduct, que sí vienen validados
      // (historial del proveedor confirmado, o IA ya matcheada al catálogo).
      const hasCode = Boolean(
        input.suggestedItemConfig?.productCode?.trim() ||
          input.suggestedProduct?.code?.trim() ||
          input.itemProductSuggestions?.[index]?.code?.trim(),
      );
      return { tipo, hasCode };
    }

    // Mismo criterio que arriba: exactItemAccount/suggestedItemConfig ya
    // vienen validados contra el catálogo real; item.codigo no.
    const hasCode = Boolean(
      exactItemAccount?.code?.trim() ||
        input.suggestedItemConfig?.accountCode?.trim() ||
        input.payloadItems[index]?.accountMapping?.code?.trim(),
    );
    return { tipo, hasCode };
  });
}

function resolveEffectiveAccountCode(
  input: PurchaseInvoiceReviewInput,
): string | null {
  if (input.draft) {
    return input.draft.accountCode?.trim() || null;
  }

  return (
    input.suggestedItemConfig?.accountCode?.trim() ||
    input.suggestedAccount?.code?.trim() ||
    null
  );
}

function resolveEffectivePaymentMethodId(
  input: PurchaseInvoiceReviewInput,
): number | null {
  if (input.draft) {
    return input.draft.paymentMethodId ?? null;
  }

  return input.suggestedItemConfig?.paymentMethod?.id ?? null;
}

function isLowAiConfidence(input: PurchaseInvoiceReviewInput): boolean {
  if (input.aiClassificationAttempted) {
    return (
      input.aiConfidence == null ||
      input.aiConfidence < AI_CONFIDENCE_REVIEW_THRESHOLD
    );
  }

  return (
    input.aiConfidence != null &&
    input.aiConfidence < AI_CONFIDENCE_REVIEW_THRESHOLD
  );
}

export function resolvePurchaseInvoiceRequiresReview(
  input: PurchaseInvoiceReviewInput,
): boolean {
  const items = resolveEffectiveItems(input);

  // Un ítem Producto sin código bloquea SIEMPRE, sin fallback a nivel de
  // documento — SIIGO no tiene un "producto por defecto".
  if (items.some((item) => item.tipo === 'Product' && !item.hasCode)) {
    return true;
  }

  // Mismo criterio que itemsSatisfyAccountRequirement en el frontend: sin
  // ítems no hay nada que dé por resuelta la cuenta (early-return a false,
  // NO vacuously true), así que sin fallback de documento igual requiere
  // revisión.
  const accountItemsAllResolved =
    items.length > 0 &&
    items.every((item) => (item.tipo === 'Account' ? item.hasCode : true));

  if (!resolveEffectiveAccountCode(input) && !accountItemsAllResolved) {
    return true;
  }

  if (resolveEffectivePaymentMethodId(input) == null) {
    return true;
  }

  if (isLowAiConfidence(input)) {
    return true;
  }

  return false;
}
