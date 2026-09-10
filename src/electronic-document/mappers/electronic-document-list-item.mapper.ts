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
): ElectronicDocumentListItemDto {
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
    aiConfidence: document.payload?.aiSuggestion?.confidence ?? null,
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
