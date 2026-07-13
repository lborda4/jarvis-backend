export interface DianParty {
  nit: string;
  nombre: string;
  tipoDocumento?: string;
  direccion?: string;
  telefono?: string;
  email?: string;
  codigoDepartamento?: string;
  codigoCiudad?: string;
  codigoPais?: string;
  codigoPostal?: string;
}

export interface DianInvoiceItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  total: number;
}

export interface DianInvoiceTotals {
  subtotal: number;
  total: number;
  iva: number;
}

export interface DianInvoiceResult {
  cufe: string;
  numeroFactura: string;
  fechaEmision: string;
  fechaVencimiento?: string;
  moneda: string;
  emisor: DianParty;
  receptor: DianParty;
  items: DianInvoiceItem[];
  totales: DianInvoiceTotals;
}

export interface DianSearchError {
  cufe: string;
  mensaje: string;
}
