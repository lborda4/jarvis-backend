export const EXCEL_COLUMNS = {
  DOCUMENT_TYPE: 'Tipo de documento',
  CUFE: 'CUFE/CUDE',
  FOLIO: 'Folio',
  PREFIX: 'Prefijo',
  CURRENCY: 'Divisa',
  PAYMENT_FORM: 'Forma de Pago',
  PAYMENT_METHOD: 'Medio de Pago',
  ISSUE_DATE: 'Fecha Emisión',
  RECEPTION_DATE: 'Fecha Recepción',
  ISSUER_NIT: 'NIT Emisor',
  ISSUER_NAME: 'Nombre Emisor',
  RECEIVER_NIT: 'NIT Receptor',
  RECEIVER_NAME: 'Nombre Receptor',
  IVA: 'IVA',
  TOTAL: 'Total',
  STATUS: 'Estado',
  GROUP: 'Grupo',
} as const;

export const DIAN_SALES_INVOICE_DOCUMENT_TYPE = 'Factura electrónica';
export const DIAN_PURCHASE_INVOICE_DOCUMENT_TYPES = [
  DIAN_SALES_INVOICE_DOCUMENT_TYPE,
  'Factura electrónica de contingencia',
  'POS electrónico',
  'Documento equivalente POS',
  'Tiquete aéreo',
  // Nombre reportado por la DIAN para el mismo tipo de documento.
  'Documento equivalente - Transporte aéreo de pasajeros',
  'Tiquete transporte pasajeros',
] as const;
export const DIAN_RECEIVED_GROUP = 'Recibido';
