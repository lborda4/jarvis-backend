export interface SiigoDocumentTypeSelection {
  support_document_id?: number;
  purchase_invoice_id?: number;
}

export interface SiigoCredentials {
  username: string;
  access_key: string;
  partner_id?: string;
  token?: string;
  expires_at?: string;
  /** Comprobantes de cargue seleccionados en el setup (DS / FC). */
  document_types?: SiigoDocumentTypeSelection;
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
  /** Token Bearer de NextPyme propio de la empresa. */
  token_nextpyme?: string;
  /** @deprecated Conservado por compatibilidad con configuraciones previas. */
  entity_type?: string;
  configured_at?: string;
  resolutions?: {
    support_document?: JarvisDianResolution;
    electronic_invoice?: JarvisDianResolution;
  };
}

export type IntegrationCredentials = SiigoCredentials | JarvisCredentials;
