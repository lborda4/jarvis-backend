import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';
import { GroupedSupportDocument } from '../interfaces/support-document-import.interface';

export function mapGroupedSupportDocumentToPayload(
  group: GroupedSupportDocument,
): ElectronicDocumentPayload {
  const items = group.rows.map((row) => ({
    descripcion: row.itemDescription,
    cantidad: row.quantity > 0 ? row.quantity : 1,
    valorUnitario: row.unitValue,
    total: row.lineTotal > 0 ? row.lineTotal : row.quantity * row.unitValue,
  }));

  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + item.total, 0),
  );
  const iva = roundMoney(group.rows.reduce((sum, row) => sum + row.taxAmount, 0));
  const total = roundMoney(subtotal + iva);
  const invoiceNumber = `${group.documentPrefix}${group.documentNumber}`;

  return {
    supplier: {
      documentNumber: group.supplierIdentification,
      documentType: group.supplierDocumentType,
      name: group.supplierName,
      commercialName: group.supplierName,
    },
    invoice: {
      cufe: group.cufe?.trim() || '',
      prefix: group.documentPrefix,
      number: invoiceNumber,
      issueDate: group.issueDate?.trim() || '',
      ...(group.dueDate ? { dueDate: group.dueDate } : {}),
      currency: group.currency,
    },
    items,
    taxes: iva > 0 ? [{ type: 'IVA', amount: iva }] : [],
    totals: {
      subtotal,
      iva,
      total,
    },
    ...(group.observations?.trim()
      ? { observations: group.observations.trim() }
      : {}),
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
