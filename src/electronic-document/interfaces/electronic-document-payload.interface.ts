import type { DianInvoiceTotals } from '../../dian/interfaces/dian-invoice-result.interface';
import type { SupplierPreferenceSnapshot } from '../../integration/interfaces/supplier-preference.interface';
import type { SupplierRetentionPreference } from '../../integration/interfaces/supplier-mapping-value.interface';
import type { ElectronicDocumentItem } from './electronic-document-item.interface';

/**
 * A diferencia de `SupplierPreferenceSnapshot` (preferencia CONFIRMADA del
 * proveedor, siempre con cuenta PUC — ver `normalizeSupplierPreferenceSnapshot`),
 * esta es la sugerencia de la clasificación automática con IA
 * (SiigoPurchaseAiClassificationService): trae `account` cuando el ítem
 * clasificó como 'Account', o `product` cuando clasificó como 'Product' —
 * nunca ambos a la vez, y cualquiera de los dos puede faltar si la IA no
 * encontró una opción segura en el catálogo correspondiente.
 */
export interface AiSuggestionSnapshot {
  account?: { code: string; name: string } | null;
  product?: { code: string; name: string } | null;
  retentions: SupplierRetentionPreference[];
  /** 0-100, qué tan segura estuvo la IA de account/product — ver
   * SiigoPurchaseAiClassificationService.classifyOne. Decide si el
   * documento se ve como "Pendiente" (≥80) o "Requiere revisión" (<80) en
   * el listado. null en snapshots viejos (de antes de este campo) o cuando
   * la clasificación automática nunca corrió para este documento. */
  confidence?: number | null;
}

export interface ElectronicDocumentSupplier {
  documentNumber: string;
  documentType: string;
  name: string;
  commercialName?: string;
  checkDigit?: string;
  address?: string;
  countryCode?: string;
  stateCode?: string;
  cityCode?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  comments?: string;
}

export interface ElectronicDocumentInvoice {
  cufe: string;
  prefix?: string;
  number: string;
  issueDate: string;
  dueDate?: string;
  /** DIAN tabla 9.5 (forma de pago): true = Crédito, false = Contado, undefined = desconocido. */
  isCreditPayment?: boolean;
  /** Días de plazo explícitos del emisor (payment_form.duration_measure) —
   * fuente más confiable que derivar dueDate - issueDate cuando está presente. */
  durationMeasure?: number;
  currency: string;
}

export interface ElectronicDocumentTax {
  type: string;
  amount: number;
}

/** Retención SUGERIDA por el vendedor, certificada en la factura DIAN
 * original (NextPyme `with_holding_tax_totals`) — a nivel de documento, no
 * por ítem. `dianTaxCode` es el código DIAN (05=ReteIVA, 06=ReteFuente/
 * ReteRenta, 07=ReteICA), la clave estable para matchear contra el
 * catálogo de SIIGO (ver resolveSuggestedRetentionsFromInvoice) — el
 * `tax_name` que trae NextPyme es texto libre e inconsistente para un
 * mismo código, no sirve para matchear. */
export interface ElectronicDocumentWithholding {
  dianTaxCode: string;
  percentage: number;
}

export interface ElectronicDocumentPayload {
  supplier: ElectronicDocumentSupplier;
  invoice: ElectronicDocumentInvoice;
  items: ElectronicDocumentItem[];
  taxes: ElectronicDocumentTax[];
  totals: DianInvoiceTotals;
  observations?: string;
  siigoSendConfiguration?: SupplierPreferenceSnapshot | null;
  /**
   * Sugerencia de IA calculada en segundo plano al importar (solo para
   * proveedores con tiene_variabilidad=true o sin historial). Se usa como
   * fallback de sugerencia cuando no hay preferencia genérica del proveedor
   * — ver resolveSuggestedAccountForDocument/resolveSuggestedRetentionsForDocument.
   */
  aiSuggestion?: AiSuggestionSnapshot | null;
  /** Retenciones sugeridas por el vendedor, certificadas en la factura DIAN
   * original — ver ElectronicDocumentWithholding. Usado como ÚLTIMO
   * fallback (después de historial confirmado, IA y preferencia guardada)
   * cuando ninguno de esos resolvió nada: ver resolveSuggestedRetentionsForDocument. */
  withholdings?: ElectronicDocumentWithholding[];
}
