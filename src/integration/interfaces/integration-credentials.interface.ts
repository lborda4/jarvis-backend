export interface SiigoDocumentTypeSelection {
  support_document_id?: number;
  purchase_invoice_id?: number;
}

/** Numeración local de notas crédito NextPyme para empresas SIIGO (sin resolución DIAN). */
export interface SiigoCreditNoteNumbering {
  prefix: string;
  fromNumber: number;
  toNumber: number;
  nextConsecutive: number;
}

export interface SiigoCredentials {
  username: string;
  access_key: string;
  partner_id?: string;
  token?: string;
  expires_at?: string;
  /** Comprobantes de cargue seleccionados en el setup (DS / FC). */
  document_types?: SiigoDocumentTypeSelection;
  /**
   * Consecutivo soft de nota crédito (NextPyme).
   * Arranca en 1 por empresa y avanza con cada envío aceptado.
   */
  credit_note?: SiigoCreditNoteNumbering;
  /** Clave técnica DIAN de la empresa (opcional; la factura electrónica la usa). */
  technical_key?: string;
}

import { JarvisResolutionKind } from '../jarvis/enums/jarvis-resolution-kind.enum';
import { JarvisTaxRegime } from '../jarvis/enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../jarvis/enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../jarvis/enums/jarvis-vat-regime.enum';

export interface JarvisDianResolution {
  kind: JarvisResolutionKind;
  formNumber?: string | null;
  nit?: string | null;
  checkDigit?: string | null;
  businessName?: string | null;
  documentTypeLabel: string;
  modalityCode?: string | null;
  prefix: string;
  /** Inicio autorizado del rango DIAN. */
  fromNumber: number;
  /** Fin autorizado del rango DIAN. */
  toNumber: number;
  /**
   * Siguiente consecutivo a emitir.
   * Se inicializa en fromNumber y avanza con cada envío exitoso.
   */
  nextConsecutive?: number | null;
  requestType?: string | null;
  year?: string | null;
  authorizedAt?: string | null;
  technicalKey?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  configuredAt?: string | null;
}

export interface JarvisCredentials {
  business_name?: string;
  trade_name?: string;
  economic_activity?: string;
  tax_regime?: JarvisTaxRegime;
  vat_regime?: JarvisVatRegime;
  tax_responsibility?: JarvisTaxResponsibility;
  country?: string;
  department?: string;
  municipality?: string;
  city?: string;
  email?: string;
  address?: string;
  phone?: string;
  /** Identificador de software DIAN/NextPyme de la empresa. */
  id_software?: string;
  /** Clave técnica DIAN de la empresa (factura electrónica). */
  technical_key?: string;
  /** Token Bearer de NextPyme propio de la empresa. */
  token_nextpyme?: string;
  /** @deprecated Conservado por compatibilidad con configuraciones previas. */
  entity_type?: string;
  configured_at?: string;
  resolutions?: {
    support_document?: JarvisDianResolution;
    debit_note?: JarvisDianResolution;
    credit_note?: JarvisDianResolution;
    electronic_invoice?: JarvisDianResolution;
  };
}

export interface BoldCredentials {
  identity_key?: string;
  secret_key?: string;
}
export type IntegrationCredentials = SiigoCredentials | JarvisCredentials | BoldCredentials;
