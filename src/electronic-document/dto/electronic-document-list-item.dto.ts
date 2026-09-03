import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../../integration/interfaces/supplier-mapping-value.interface';
import { ElectronicDocumentListItemItemDto } from './electronic-document-list-item-item.dto';
import {
  SuggestedProduct,
  SuggestedPurchaseItemConfig,
} from '../../integration/helpers/supplier-preference.helper';

export class ElectronicDocumentListItemDto {
  id: string;
  companyId: string;
  companyName: string;
  cufe: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  /** Días de plazo explícitos del emisor (payment_form.duration_measure) — más confiable que dueDate - issueDate cuando está presente. */
  paymentDurationMeasure: number | null;
  /** Descuento general del documento (DIAN allowance_total_amount), ya restado de `total` pero no de `items`. */
  documentDiscount: number | null;
  supplierName: string | null;
  supplierNit: string | null;
  supplierDocumentType: string | null;
  /** Subtotal certificado por la DIAN (tax_exclusive_amount) — no recalcular desde items. */
  documentSubtotal: number;
  /** IVA certificado por la DIAN (suma de tax_totals de factura) — no recalcular desde items. */
  documentIva: number;
  total: number;
  status: string;
  electronicDocumentType: string | null;
  siigoDocumentNumber: string | null;
  supplierExistsInSiigo: boolean | null;
  /** true si quedó en PURCHASE_CREATED porque la factura ya existía en
   * SIIGO al importar el Excel (match por provider_invoice), no porque se
   * envió desde Jarvis — el frontend lo muestra como "Existente en SIIGO"
   * en vez de "Lista" (ver mapDocumentToImportRowStatus). */
  alreadyInSiigo: boolean;
  suggestedAccount: SuggestedAccount | null;
  /** Sugerencia de producto (solo cuando la clasificación con IA determinó
   * itemType='Product') — a diferencia de `suggestedAccount`, no tiene un
   * fallback de historial por proveedor a nivel documento; ese fallback se
   * resuelve por ítem vía `suggestedItemConfig.productCode`. */
  suggestedProduct: SuggestedProduct | null;
  suggestedPaymentMethod: SupplierPaymentMethodPreference | null;
  suggestedRetentions: SupplierRetentionPreference[];
  suggestedCostCenter: SupplierCostCenterPreference | null;
  /** Config de ítem (tipo, cuenta/producto, IVA, Retefuente, medio de pago)
   * aprendida del historial de compras de este proveedor — cada campo trae
   * su valor solo si ESE campo puntual es fijo (≥70% consistente) según el
   * sync; si es variable, ese campo viene en null pero los demás campos
   * fijos siguen llegando completos. El objeto entero es null solo si el
   * proveedor es nuevo o nunca se sincronizó. */
  suggestedItemConfig: SuggestedPurchaseItemConfig | null;
  observations?: string | null;
  items?: ElectronicDocumentListItemItemDto[];
  createdAt: string;
  updatedAt: string;
}
