export interface SupportDocumentExcelRow {
  supplierIdentification: string;
  supplierDocumentType: string;
  supplierName: string;
  documentPrefix: string;
  documentNumber: string;
  issueDate: string;
  dueDate?: string;
  cufe?: string;
  receiverIdentification?: string;
  currency?: string;
  itemDescription: string;
  itemCode?: string;
  quantity: number;
  unitValue: number;
  lineTotal: number;
  taxAmount: number;
  costCenter?: string;
  observations?: string;
}

export interface GroupedSupportDocument {
  groupKey: string;
  supplierIdentification: string;
  supplierDocumentType: string;
  supplierName: string;
  documentPrefix: string;
  documentNumber: string;
  issueDate: string;
  dueDate?: string;
  cufe?: string;
  receiverIdentification?: string;
  currency: string;
  /** Texto de la columna "Centro de costos" del Excel — normalmente
   * "código - nombre" (viene de la lista desplegable de la plantilla, ver
   * buildSupportDocumentTemplateExcel), aunque también se acepta texto
   * libre escrito a mano. Se resuelve contra el catálogo real de SIIGO
   * recién al momento de sugerir/enviar (ver resolveSiigoCostCenter). */
  costCenter?: string;
  observations?: string;
  rows: SupportDocumentExcelRow[];
}
