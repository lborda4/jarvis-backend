import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
import { ElectronicDocumentListItemDto } from '../dto/electronic-document-list-item.dto';
import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../../integration/interfaces/supplier-mapping-value.interface';

export function mapElectronicDocumentToListItem(
  document: ElectronicDocument,
  suggestedAccount: SuggestedAccount | null = null,
  suggestedPaymentMethod: SupplierPaymentMethodPreference | null = null,
  suggestedRetentions: SupplierRetentionPreference[] = [],
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
    total: Number(document.payload?.totals?.total ?? 0),
    status: document.status,
    electronicDocumentType: document.electronicDocumentType,
    supplierExistsInSiigo: document.supplierExistsInSiigo,
    suggestedAccount,
    suggestedPaymentMethod,
    suggestedRetentions,
    processingStatus: document.processingStatus,
    items: mapSupportDocumentItems(document),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function mapSupportDocumentItems(
  document: ElectronicDocument,
): ElectronicDocumentListItemDto['items'] {
  if (document.electronicDocumentType !== ElectronicDocumentType.SUPPORT_DOCUMENT) {
    return undefined;
  }

  const items = document.payload?.items;

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item) => ({
    description: item.descripcion?.trim() || 'Ítem importado',
    quantity: item.cantidad > 0 ? item.cantidad : 1,
    unitValue: item.valorUnitario > 0 ? item.valorUnitario : item.total,
    total: item.total,
  }));
}
