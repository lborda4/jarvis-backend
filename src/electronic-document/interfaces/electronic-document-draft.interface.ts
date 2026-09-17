/**
 * Borrador de contabilización de un documento: lo que el contador ajustó en
 * el panel de detalle y todavía NO se ha enviado a SIIGO.
 *
 * Vive en electronic_documents.draft y no en el historial de SIIGO: el
 * historial solo se escribe cuando el envío salió bien y SIIGO confirmó, así
 * que es el registro de lo que ocurrió de verdad, no de lo que se está
 * preparando.
 *
 * Se guardan códigos e ids, no los objetos del catálogo: si mañana cambia el
 * nombre de una cuenta o se reimporta el plan de cuentas, el borrador sigue
 * apuntando a lo mismo en vez de conservar una copia vieja.
 */
export interface ElectronicDocumentDraftItem {
  tipo: 'Product' | 'FixedAsset' | 'Account';
  /** Código SIIGO del producto/activo o de la cuenta contable. */
  producto: string;
  description: string;
  quantity: number;
  unitValue: number;
  discount: number;
  ivaTaxId?: number | null;
  retefuenteTaxId?: number | null;
}

export interface ElectronicDocumentDraft {
  items?: ElectronicDocumentDraftItem[];
  /** Cuenta contable a nivel de documento (respaldo de los ítems). */
  accountCode?: string | null;
  paymentMethodId?: number | null;
  dueDate?: string | null;
  observations?: string | null;
  /** Retenciones elegidas a nivel de documento (Rete ICA, Rete IVA...). */
  retentionTaxIds?: number[];
  documentDiscount?: number | null;
  /** Cuándo se guardó, para poder mostrar "guardado hace un momento". */
  savedAt: string;
}
