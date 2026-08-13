import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentListItemDto } from '../dto/electronic-document-list-item.dto';
import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../../integration/interfaces/supplier-mapping-value.interface';
import { SuggestedItemTax } from '../../integration/siigo/helpers/siigo-item-tax-suggestion.helper';

export function mapElectronicDocumentToListItem(
  document: ElectronicDocument,
  suggestedAccount: SuggestedAccount | null = null,
  suggestedPaymentMethod: SupplierPaymentMethodPreference | null = null,
  suggestedRetentions: SupplierRetentionPreference[] = [],
  suggestedCostCenter: SupplierCostCenterPreference | null = null,
  itemTaxSuggestions: Array<SuggestedItemTax | null> = [],
): ElectronicDocumentListItemDto {
  return {
    id: document.id,
    companyId: document.companyId,
    companyName: document.company?.name ?? '—',
    cufe: document.cufe,
    invoiceNumber: document.payload?.invoice?.number ?? null,
    issueDate: document.payload?.invoice?.issueDate ?? null,
    supplierName: document.payload?.supplier?.name ?? null,
    supplierNit:
      document.documentNumberThird ??
      document.payload?.supplier?.documentNumber ??
      null,
    supplierDocumentType:
      document.documentTypeThird ??
      document.payload?.supplier?.documentType ??
      null,
    total: Number(document.payload?.totals?.total ?? 0),
    status: document.status,
    electronicDocumentType: document.electronicDocumentType,
    siigoDocumentNumber: document.siigoDocumentNumber,
    supplierExistsInSiigo: document.supplierExistsInSiigo,
    suggestedAccount,
    suggestedPaymentMethod,
    suggestedRetentions,
    suggestedCostCenter,
    processingStatus: document.processingStatus,
    observations: document.payload?.observations?.trim() || null,
    items: mapDocumentItems(document, itemTaxSuggestions),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function mapDocumentItems(
  document: ElectronicDocument,
  itemTaxSuggestions: Array<SuggestedItemTax | null>,
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
    suggestedTax: itemTaxSuggestions[index] ?? null,
  }));
}
