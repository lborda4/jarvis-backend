import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentListItemDto } from '../dto/electronic-document-list-item.dto';
import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../../integration/interfaces/supplier-mapping-value.interface';
import { SuggestedItemTax } from '../../integration/siigo/helpers/siigo-item-tax-suggestion.helper';
import {
  SuggestedItemAccount,
  SuggestedProduct,
  SuggestedPurchaseItemConfig,
} from '../../integration/helpers/supplier-preference.helper';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
import { resolvePurchaseInvoiceRequiresReview } from '../helpers/purchase-invoice-review.helper';

/** Extraído para que el service pueda calcular `requiresReview` UNA vez y
 * reusarlo tanto para filtrar/paginar (ver needsPurchaseInvoiceReviewNarrowing
 * en electronic-document.service.ts) como para el DTO final — sin esto, el
 * camino de filtrado tendría que llamarlo de nuevo dentro del mapper con los
 * mismos argumentos, calculándolo dos veces por documento. */
export function computeElectronicDocumentRequiresReview(
  document: ElectronicDocument,
  isSiigoCompany: boolean,
  suggestedAccount: SuggestedAccount | null,
  suggestedProduct: SuggestedProduct | null,
  suggestedItemConfig: SuggestedPurchaseItemConfig | null,
  itemAccountSuggestions: Array<SuggestedItemAccount | null>,
  aiConfidence: number | null,
): boolean {
  return (
    isSiigoCompany &&
    document.electronicDocumentType === ElectronicDocumentType.PURCHASE_INVOICE &&
    resolvePurchaseInvoiceRequiresReview({
      draft: document.draft ?? null,
      payloadItems: document.payload?.items ?? [],
      suggestedAccount,
      suggestedProduct,
      suggestedItemConfig,
      itemAccountSuggestions,
      aiConfidence,
    })
  );
}

export function mapElectronicDocumentToListItem(
  document: ElectronicDocument,
  suggestedAccount: SuggestedAccount | null = null,
  suggestedPaymentMethod: SupplierPaymentMethodPreference | null = null,
  suggestedRetentions: SupplierRetentionPreference[] = [],
  suggestedCostCenter: SupplierCostCenterPreference | null = null,
  itemTaxSuggestions: Array<SuggestedItemTax | null> = [],
  suggestedItemConfig: SuggestedPurchaseItemConfig | null = null,
  itemAccountSuggestions: Array<SuggestedItemAccount | null> = [],
  suggestedProduct: SuggestedProduct | null = null,
  /** true si la empresa activa usa SIIGO (no Jarvis) — "Requiere revisión"
   * solo existe para Factura de compra + SIIGO; el tipo de documento en sí
   * lo verifica esta función abajo con el campo real de CADA documento. */
  isSiigoCompany = false,
  /** Si el llamador ya calculó requiresReview (ver
   * computeElectronicDocumentRequiresReview), se usa ese valor en vez de
   * recalcularlo acá — evita el doble cálculo en el camino de filtrado. */
  precomputedRequiresReview?: boolean,
): ElectronicDocumentListItemDto {
  const aiConfidence = document.payload?.aiSuggestion?.confidence ?? null;
  const requiresReview =
    precomputedRequiresReview ??
    computeElectronicDocumentRequiresReview(
      document,
      isSiigoCompany,
      suggestedAccount,
      suggestedProduct,
      suggestedItemConfig,
      itemAccountSuggestions,
      aiConfidence,
    );

  return {
    id: document.id,
    companyId: document.companyId,
    companyName: document.company?.name ?? '—',
    cufe: document.cufe,
    invoiceNumber: document.payload?.invoice?.number ?? null,
    issueDate: document.payload?.invoice?.issueDate ?? null,
    dueDate: document.payload?.invoice?.dueDate ?? null,
    paymentDurationMeasure: document.payload?.invoice?.durationMeasure ?? null,
    documentDiscount: document.payload?.totals?.discount ?? null,
    supplierName: document.payload?.supplier?.name ?? null,
    supplierNit:
      document.documentNumberThird ??
      document.payload?.supplier?.documentNumber ??
      null,
    supplierDocumentType:
      document.documentTypeThird ??
      document.payload?.supplier?.documentType ??
      null,
    documentSubtotal: Number(document.payload?.totals?.subtotal ?? 0),
    documentIva: Number(document.payload?.totals?.iva ?? 0),
    total: Number(document.payload?.totals?.total ?? 0),
    status: document.status,
    electronicDocumentType: document.electronicDocumentType,
    siigoDocumentNumber: document.siigoDocumentNumber,
    supplierExistsInSiigo: document.supplierExistsInSiigo,
    alreadyInSiigo: document.alreadyInSiigo,
    draft: document.draft ?? null,
    suggestedAccount,
    suggestedProduct,
    suggestedPaymentMethod,
    suggestedRetentions,
    suggestedCostCenter,
    suggestedItemConfig,
    aiConfidence,
    requiresReview,
    observations: document.payload?.observations?.trim() || null,
    items: mapDocumentItems(
      document,
      itemTaxSuggestions,
      itemAccountSuggestions,
    ),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function mapDocumentItems(
  document: ElectronicDocument,
  itemTaxSuggestions: Array<SuggestedItemTax | null>,
  itemAccountSuggestions: Array<SuggestedItemAccount | null>,
): ElectronicDocumentListItemDto['items'] {
  const items = document.payload?.items;

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item, index) => ({
    description: item.descripcion?.trim() || 'Ítem importado',
    quantity: item.cantidad > 0 ? item.cantidad : 1,
    unitValue: item.valorUnitario > 0 ? item.valorUnitario : item.total,
    total: item.total,
    ...(item.codigo?.trim() ? { code: item.codigo.trim() } : {}),
    ...(item.discount ? { discount: item.discount } : {}),
    suggestedTax: itemTaxSuggestions[index] ?? null,
    suggestedAccount: itemAccountSuggestions[index] ?? null,
  }));
}
