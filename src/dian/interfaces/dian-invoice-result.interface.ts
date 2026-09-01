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
  /** Descuento general a nivel de documento (allowance_total_amount), no atribuible a una línea puntual. */
  discount?: number;
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
