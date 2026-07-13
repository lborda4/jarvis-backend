import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';
import { mapGroupedSupportDocumentToPayload } from '../../electronic-document/mappers/support-document-excel-to-payload.mapper';
import { resolveImportedSupplierName } from '../../integration/helpers/supplier-name-resolution.helper';
import { InvoicePreviewDto } from '../dto/invoice-preview.dto';

export function mapGroupedSupportDocumentToPreview(
  group: GroupedSupportDocument,
  documentId: string,
  supplierNamesByNit?: Map<string, string>,
): InvoicePreviewDto {
  const payload = mapGroupedSupportDocumentToPayload(group);
  const supplierName = resolveImportedSupplierName(
    group.supplierIdentification.replace(/[^\d]/g, ''),
    group.supplierName,
    supplierNamesByNit ?? new Map(),
  );

  return {
    cufe: documentId,
    documentType: 'Documento soporte',
    issueDate: group.issueDate?.trim() || '',
    receptionDate: '',
    issuerNit: group.supplierIdentification,
    issuerName: supplierName,
    receiverNit: group.receiverIdentification ?? '',
    receiverName: group.supplierName,
    currency: group.currency,
    paymentMethod: '',
    total: payload.totals.total,
    status: 'PENDING',
    group: `${group.documentPrefix}${group.documentNumber}`,
  };
}
