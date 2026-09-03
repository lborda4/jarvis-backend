import { HistorialFactura } from '../entities/historial-factura.entity';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import type { HistorialFacturaTaxDetail } from '../interfaces/historial-factura-impuestos.interface';
import { SiigoPaymentTypeCatalogItemDto } from '../siigo/dto/list-siigo-payment-types.dto';
import { SupplierPaymentMethodPreference } from '../interfaces/supplier-mapping-value.interface';
import {
  isAllowedAccountCode,
  SuggestedAccount,
} from './supplier-accounts-catalog.helper';
import { SuggestedPurchaseItemConfig } from './supplier-preference.helper';

export interface HistorialFacturaInvoiceSnapshot {
  account: SuggestedAccount | null;
  paymentMethod: SupplierPaymentMethodPreference | null;
  itemConfig: SuggestedPurchaseItemConfig | null;
}

/** Solo devuelve un valor cuando TODAS las líneas de la factura coinciden —
 * a diferencia de la variabilidad por historial (que promedia entre MUCHAS
 * facturas de un proveedor), acá se tiene la factura real completa, así que
 * "inconsistente entre sus propias líneas" (proveedor con varios conceptos a
 * distinta cuenta) se deja sin sugerir en vez de elegir cualquiera. */
function resolveConsistentValue<T>(
  lines: HistorialFactura[],
  select: (line: HistorialFactura) => T,
): T | null {
  const [first, ...rest] = lines;
  const firstValue = select(first);

  return rest.every((line) => select(line) === firstValue)
    ? firstValue
    : null;
}

function resolveConsistentTax(
  lines: HistorialFactura[],
  campo: 'iva' | 'retefuente',
): HistorialFacturaTaxDetail | null {
  const [first, ...rest] = lines;
  const firstId = first.impuestos?.[campo]?.id ?? null;
  const allMatch = rest.every(
    (line) => (line.impuestos?.[campo]?.id ?? null) === firstId,
  );

  return allMatch ? (first.impuestos?.[campo] ?? null) : null;
}

/** Medio de pago real de la factura (SiigoPurchaseResponse.payments[0], ver
 * historial-factura.entity.ts) cruzado contra el catálogo VIGENTE de medios
 * de pago — historial solo guarda id+nombre tal como estaban en el momento
 * del sync, sin `type`/`dueDate` (necesarios para saber si es a crédito), así
 * que si el medio de pago ya no existe en el catálogo actual se deja sin
 * sugerir en vez de inventar esos campos. */
function resolvePaymentMethodFromHistorial(
  line: HistorialFactura,
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
): SupplierPaymentMethodPreference | null {
  if (line.metodoPagoId == null) {
    return null;
  }

  const catalogEntry = paymentTypesCatalog.find(
    (paymentType) => paymentType.id === line.metodoPagoId,
  );

  if (!catalogEntry) {
    return null;
  }

  return {
    id: catalogEntry.id,
    name: catalogEntry.name,
    type: catalogEntry.type,
    dueDate: catalogEntry.dueDate,
  };
}

/**
 * Arma cuenta contable, medio de pago e ítem-config a partir de las líneas
 * YA SINCRONIZADAS desde SIIGO de una factura puntual (ver
 * HistorialFacturasRepository.findLinesByFacturaId) — se usa cuando una
 * factura de compra importada por Excel resultó ya creada en SIIGO (match por
 * provider_invoice) para mostrar la configuración REAL con la que quedó esa
 * factura en SIIGO, en vez de dejar los campos en blanco como si nunca se
 * hubiera clasificado (ver resolveSuggestedAccountForDocument y compañía,
 * que devuelven null para documentos PURCHASE_CREATED sin
 * `payload.siigoSendConfiguration`, que es justo el caso de estas facturas:
 * nunca se enviaron desde Jarvis, así que ese snapshot nunca se guardó).
 */
export function buildInvoiceSnapshotFromHistorialLines(
  lines: HistorialFactura[],
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
): HistorialFacturaInvoiceSnapshot {
  if (lines.length === 0) {
    return { account: null, paymentMethod: null, itemConfig: null };
  }

  const consistentTipo = resolveConsistentValue(lines, (line) => line.tipo);
  const consistentCuenta = resolveConsistentValue(
    lines,
    (line) => line.cuentaPuc,
  );
  const consistentIva = resolveConsistentTax(lines, 'iva');
  const consistentRetefuente = resolveConsistentTax(lines, 'retefuente');

  const itemType =
    consistentTipo === HistorialFacturaTipo.PRODUCTO
      ? 'Product'
      : consistentTipo === HistorialFacturaTipo.CUENTA
        ? 'Account'
        : null;
  const isProductType = itemType === 'Product';

  const accountCode =
    !isProductType &&
    consistentCuenta &&
    isAllowedAccountCode(consistentCuenta)
      ? consistentCuenta
      : null;
  const productCode = isProductType && consistentCuenta ? consistentCuenta : null;

  const paymentMethod = resolvePaymentMethodFromHistorial(
    lines[0],
    paymentTypesCatalog,
  );

  return {
    account: accountCode
      ? { code: accountCode, name: accountCode, uses: lines.length }
      : null,
    paymentMethod,
    itemConfig: {
      itemType,
      accountCode,
      accountName: accountCode,
      productCode,
      productName: productCode,
      ivaTax: consistentIva,
      retefuenteTax: consistentRetefuente,
      paymentMethod,
    },
  };
}
