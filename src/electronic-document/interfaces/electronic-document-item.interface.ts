export interface ElectronicDocumentItemAccountMapping {
  code: string;
  description?: string;
}

export interface ElectronicDocumentItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  total: number;
  codigo?: string;
  accountMapping?: ElectronicDocumentItemAccountMapping;
  /** % de IVA del ítem tal como viene en la factura original (DIAN/NextPyme). */
  ivaPercentage?: number;
}
