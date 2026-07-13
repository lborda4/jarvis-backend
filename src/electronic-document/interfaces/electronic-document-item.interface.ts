export interface ElectronicDocumentItemAccountMapping {
  code: string;
  description?: string;
}

export interface ElectronicDocumentItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  total: number;
  accountMapping?: ElectronicDocumentItemAccountMapping;
}
