import { DianInvoiceResult } from '../../dian/interfaces/dian-invoice-result.interface';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

export function mapDianResultToElectronicDocumentPayload(
  result: DianInvoiceResult,
): ElectronicDocumentPayload {
  const taxes =
    result.totales.iva > 0
      ? [{ type: 'IVA', amount: result.totales.iva }]
      : [];

  const documentType = result.emisor.tipoDocumento?.trim() || 'NIT';

  return {
    supplier: {
      documentNumber: result.emisor.nit?.trim() || '',
      documentType,
      name: result.emisor.nombre?.trim() || '',
      commercialName: result.emisor.nombre?.trim() || '',
      address: result.emisor.direccion?.trim() || '',
      phone: result.emisor.telefono?.trim() || '',
      email: result.emisor.email?.trim() || '',
      stateCode: result.emisor.codigoDepartamento?.trim() || '',
      cityCode: result.emisor.codigoCiudad?.trim() || '',
      postalCode: result.emisor.codigoPostal?.trim() || '',
      countryCode: result.emisor.codigoPais?.trim() || 'Co',
    },
    invoice: {
      cufe: result.cufe,
      number: result.numeroFactura,
      issueDate: result.fechaEmision,
      ...(result.fechaVencimiento?.trim()
        ? { dueDate: result.fechaVencimiento.trim() }
        : {}),
      currency: result.moneda,
    },
    items: result.items,
    taxes,
    totals: result.totales,
  };
}
