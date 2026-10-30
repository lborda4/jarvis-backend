import { BadRequestException } from '@nestjs/common';
import type { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import type { ElectronicDocumentPayload } from '../../electronic-document/interfaces/electronic-document-payload.interface';
import type { DianSalesInvoiceRow } from './sales-invoice-excel.helper';

export function normalizePurchaseInvoiceCufe(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{96}$/i.test(value.trim())) {
    throw new BadRequestException(
      'Ingresa un CUFE válido de 96 caracteres hexadecimales.',
    );
  }
  return value.trim().toLowerCase();
}

export function emptyCufeImportRow(cufe: string): DianSalesInvoiceRow {
  return {
    importSource: 'CUFE',
    cufe,
    documentType: 'Factura electrónica',
    folio: '',
    prefix: '',
    currency: 'COP',
    paymentForm: '',
    paymentMethod: '',
    issueDate: '',
    receptionDate: '',
    issuerNit: '',
    issuerName: '',
    receiverNit: '',
    receiverName: '',
    iva: 0,
    total: 0,
    status: '',
    group: 'Recibido',
  };
}

export function resolveCufeImportRow(
  data: NextPymeInvoiceQueryResult,
  payload: ElectronicDocumentPayload,
  companyNit?: string,
): DianSalesInvoiceRow {
  const nit = (value: unknown) =>
    String(value ?? '')
      .split('-')[0]
      .replace(/\D/g, '');
  if (
    !nit(companyNit) ||
    !nit(data.customer?.identification_number) ||
    nit(companyNit) !== nit(data.customer?.identification_number)
  ) {
    throw new BadRequestException(
      'La factura no corresponde a una compra recibida por la empresa activa.',
    );
  }
  if (![1, 2].includes(Number(data.type_document_id))) {
    throw new BadRequestException(
      'El CUFE consultado no corresponde a una factura de compra válida.',
    );
  }
  if (
    !(payload.totals.total > 0) ||
    !payload.supplier.documentNumber?.trim() ||
    !payload.supplier.name?.trim() ||
    !payload.invoice.number?.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.invoice.issueDate) ||
    !data.invoice_lines?.length
  ) {
    throw new BadRequestException(
      'La factura consultada no contiene los datos completos para importarla.',
    );
  }
  return {
    ...emptyCufeImportRow(payload.invoice.cufe),
    folio: String(data.number ?? ''),
    prefix: payload.invoice.prefix ?? '',
    currency: payload.invoice.currency ?? 'COP',
    issueDate: payload.invoice.issueDate,
    issuerNit: payload.supplier.documentNumber,
    issuerName: payload.supplier.name,
    receiverNit: String(data.customer?.identification_number ?? ''),
    receiverName: data.customer?.name ?? '',
    paymentForm: payload.invoice.isCreditPayment ? 'Crédito' : 'Contado',
    paymentMethod: payload.invoice.paymentMethodCode ?? '',
    iva: payload.totals.iva,
    total: payload.totals.total,
  };
}
