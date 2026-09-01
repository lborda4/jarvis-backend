import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from '../entities/supplier-item-account-mapping.entity';
import {
  isAllowedAccountCode,
  SuggestedAccount,
} from './supplier-accounts-catalog.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';
import { SupplierPreferenceSnapshot } from '../interfaces/supplier-preference.interface';
import { HistorialFacturaTaxDetail } from '../interfaces/historial-factura-impuestos.interface';
import { SupplierFieldVariabilityEntry } from '../interfaces/supplier-field-variability.interface';
import { normalizeSupplierCostCenterPreference } from './supplier-mapping-value.helper';
import { mapImpuestosToRetentionPreferences } from '../siigo/helpers/siigo-purchase-tax-classification.helper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSupplierPreferenceSnapshot(
  value: unknown,
): SupplierPreferenceSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const account = value.account;

  if (!isRecord(account)) {
    return null;
  }

  const accountCode = String(account.code ?? '').trim();
  const accountName = String(account.name ?? '').trim();

  if (!accountCode) {
    return null;
  }

  const paymentMethod = value.paymentMethod;
  let normalizedPaymentMethod:
    | SupplierPaymentMethodPreference
    | null
    | undefined;

  if (paymentMethod === undefined) {
    normalizedPaymentMethod = undefined;
  } else if (paymentMethod === null) {
    normalizedPaymentMethod = null;
  } else if (isRecord(paymentMethod)) {
    const paymentMethodId = Number(paymentMethod.id);

    if (!Number.isFinite(paymentMethodId) || paymentMethodId <= 0) {
      normalizedPaymentMethod = null;
    } else {
      normalizedPaymentMethod = {
        id: paymentMethodId,
        name:
          String(paymentMethod.name ?? '').trim() || `Medio ${paymentMethodId}`,
        type: String(paymentMethod.type ?? '').trim(),
        ...(paymentMethod.dueDate === undefined
          ? {}
          : { dueDate: Boolean(paymentMethod.dueDate) }),
      };
    }
  } else {
    return null;
  }

  const rawRetentions = Array.isArray(value.retentions) ? value.retentions : [];
  const retentions = rawRetentions
    .map((retention): SupplierRetentionPreference | null => {
      if (!isRecord(retention)) {
        return null;
      }

      const id = Number(retention.id);

      if (!Number.isFinite(id) || id <= 0) {
        return null;
      }

      return {
        id,
        name: String(retention.name ?? '').trim() || `Retención ${id}`,
        type: String(retention.type ?? '').trim(),
        percentage: Number(retention.percentage ?? 0),
      };
    })
    .filter(
      (retention): retention is SupplierRetentionPreference =>
        retention !== null,
    );

  return {
    account: {
      code: accountCode,
      name: accountName || accountCode,
    },
    ...(normalizedPaymentMethod !== undefined
      ? { paymentMethod: normalizedPaymentMethod }
      : {}),
    retentions,
    ...(value.costCenter !== undefined
      ? {
          costCenter: normalizeSupplierCostCenterPreference(value.costCenter),
        }
      : {}),
  };
}

export function resolveSuggestedAccountFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SuggestedAccount | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(
    configuration?.preference,
  );

  if (!snapshot || !isAllowedAccountCode(snapshot.account.code)) {
    return null;
  }

  return {
    code: snapshot.account.code,
    name: snapshot.account.name,
    uses: 1,
  };
}

export interface SuggestedProduct {
  code: string;
  name: string;
}

export interface SuggestedItemAccount {
  code: string;
  name: string;
  /** 'exact' = regla confirmada para esta descripción puntual del
   * proveedor; 'fallback' = el proveedor tiene una única cuenta en todo su
   * historial pero esta descripción es nueva — se sugiere, pero no se debe
   * tratar como confirmada (ver resolveSuggestedAccountForItem). */
  source: 'exact' | 'fallback';
}

/**
 * Orden de resolución de cuenta PUC para UN ítem puntual de una factura:
 * 1) regla exacta (proveedor + descripción normalizada) → automática.
 * 2) el proveedor tiene una única cuenta en todo su historial (fallback ya
 *    existente en SupplierConfiguration.preference) y esta descripción es
 *    nueva → se sugiere, pero marcada 'fallback' para que el contador la
 *    revise — nunca se aplica en silencio como si fuera una regla
 *    confirmada.
 * 3) ninguna de las dos → null, requiere asignación manual.
 */
export function resolveSuggestedAccountForItem(
  itemMapping:
    | Pick<SupplierItemAccountMapping, 'accountCode' | 'accountName'>
    | null
    | undefined,
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SuggestedItemAccount | null {
  if (itemMapping?.accountCode?.trim()) {
    return {
      code: itemMapping.accountCode,
      name: itemMapping.accountName?.trim() || itemMapping.accountCode,
      source: 'exact',
    };
  }

  const fallback = resolveSuggestedAccountFromPreference(configuration);

  if (!fallback) {
    return null;
  }

  return { code: fallback.code, name: fallback.name, source: 'fallback' };
}

export function resolveSuggestedPaymentMethodFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierPaymentMethodPreference | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(
    configuration?.preference,
  );

  return snapshot?.paymentMethod ?? null;
}

/** Toma el `valor` de un campo del historial solo cuando el sync lo marcó
 * fijo (`variable: false`) — `undefined` (campo nunca calculado) y
 * `variable: true` se tratan igual: sin sugerencia confiable, se resuelve
 * con el dato de la transacción actual en vez de asumir uno. */
function resolveFixedFieldValue<T>(
  entry: SupplierFieldVariabilityEntry<T> | undefined,
): T | null {
  if (!entry || entry.variable) {
    return null;
  }

  return entry.valor;
}

/** Medio de pago dominante del sync de historial de SIIGO — variabilidad
 * calculada de forma independiente para ESTE campo (ver
 * SupplierFieldVariability en supplier-field-variability.interface.ts): un
 * proveedor puede tener cuenta contable 100% fija y medio de pago variable
 * (o al revés) sin que un solo booleano "tiene_variabilidad" a nivel de
 * proveedor completo apague la sugerencia de ambos. Más confiable que
 * `resolveSuggestedPaymentMethodFromPreference` (que se basa en el último
 * envío manual, sin importar qué tan consistente sea el proveedor). */
export function resolveSuggestedPaymentMethodFromSync(
  configuration:
    | Pick<SupplierConfiguration, 'campoVariabilidad'>
    | null
    | undefined,
): SupplierPaymentMethodPreference | null {
  return resolveFixedFieldValue(configuration?.campoVariabilidad?.medioPago);
}

export function resolveSuggestedRetentionsFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierRetentionPreference[] | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(
    configuration?.preference,
  );

  if (!snapshot) {
    return null;
  }

  return snapshot.retentions;
}

/** Retenciones (Retefuente/ReteICA/Autorretención — IVA no es una retención,
 * se excluye a propósito) armadas a partir de la variabilidad por campo del
 * sync de historial: cada categoría se evalúa de forma independiente, así
 * que un proveedor puede sugerir ReteICA fijo aunque Retefuente varíe (o
 * aunque la cuenta contable varíe). null si no hay ninguna categoría
 * calculada todavía (proveedor nunca sincronizado). */
export function resolveSuggestedRetentionsFromSync(
  configuration:
    | Pick<SupplierConfiguration, 'campoVariabilidad'>
    | null
    | undefined,
): SupplierRetentionPreference[] | null {
  const fields = configuration?.campoVariabilidad;

  if (
    !fields ||
    (fields.retefuente === undefined &&
      fields.reteica === undefined &&
      fields.autorretencion === undefined)
  ) {
    return null;
  }

  return mapImpuestosToRetentionPreferences({
    retefuente: resolveFixedFieldValue(fields.retefuente) ?? undefined,
    reteica: resolveFixedFieldValue(fields.reteica) ?? undefined,
    autorretencion: resolveFixedFieldValue(fields.autorretencion) ?? undefined,
  });
}

export function resolveSuggestedCostCenterFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierCostCenterPreference | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(
    configuration?.preference,
  );

  return snapshot?.costCenter ?? null;
}

/** Config a nivel de ítem para Factura de compra armada a partir del
 * historial de un proveedor — CADA campo se autocompleta de forma
 * independiente según SU PROPIA variabilidad (ver
 * SupplierFieldVariability): un proveedor puede tener cuenta contable 100%
 * fija y medio de pago variable, o Retefuente fijo pero IVA variable, sin
 * que un solo booleano a nivel de proveedor completo apague TODAS las
 * sugerencias porque UN campo no fue consistente. `null` en un campo
 * puntual significa "no hay un valor confiable para este campo" — no que
 * el proveedor entero sea nuevo o desconocido; el front deja ESE campo en
 * blanco (o cae a su propio fallback) y sigue autocompletando el resto. El
 * objeto completo solo es `null` cuando no hay ninguna configuración
 * sincronizada todavía para ese NIT. */
export interface SuggestedPurchaseItemConfig {
  itemType: 'Account' | 'Product' | null;
  accountCode: string | null;
  accountName: string | null;
  /** Código de producto dominante del historial de este proveedor — solo se
   * calcula cuando `itemType` es 'Product' (el mismo campo `cuenta_puc` de
   * historial_facturas guarda el código del ítem tal cual venía en la
   * factura, sea una cuenta PUC o un código de producto del vendedor, según
   * `tipo`). Nunca se valida acá con un heurístico de forma (a diferencia de
   * `accountCode` con `isAllowedAccountCode`) — la validación real contra el
   * catálogo de productos de SIIGO ocurre en el frontend. */
  productCode: string | null;
  productName: string | null;
  ivaTax: HistorialFacturaTaxDetail | null;
  retefuenteTax: HistorialFacturaTaxDetail | null;
  /** Medio de pago dominante del historial (ver
   * `resolveSuggestedPaymentMethodFromSync`) — al autocompletarlo, si es de
   * crédito (`dueDate: true`), el editor de Factura de compra muestra el
   * campo Plazo/Fecha de vencimiento igual que si el usuario lo hubiera
   * elegido a mano (ver `isCreditPaymentMethod` en el front). */
  paymentMethod: SupplierPaymentMethodPreference | null;
}

export function resolveSuggestedItemConfigFromConfiguration(
  configuration:
    | Pick<SupplierConfiguration, 'campoVariabilidad'>
    | null
    | undefined,
): SuggestedPurchaseItemConfig | null {
  if (!configuration) {
    return null;
  }

  const fields = configuration.campoVariabilidad ?? {};
  const itemType = resolveFixedFieldValue(fields.tipoItem);
  const rawItemCode = resolveFixedFieldValue(fields.cuentaPuc);
  const isProductType = itemType === 'Product';

  // Igual que resolveSuggestedAccountFromPreference: un código dominante en
  // el historial que no es clase 5/6/7 (gasto/costo) no es una cuenta
  // contable válida para autocompletar — puede ser basura heredada de un
  // sync viejo (bug real: un proveedor con "1" como cuentaPuc dominante en
  // historial_facturas autocompletaba "1 - 1" en el editor de ítems). Solo
  // aplica cuando el tipo dominante es 'Account': si es 'Product' este mismo
  // código dominante es un código de producto del vendedor, no una cuenta —
  // exigirle forma de cuenta PUC lo descartaría siempre.
  const accountCode =
    !isProductType && rawItemCode && isAllowedAccountCode(rawItemCode)
      ? rawItemCode
      : null;
  const productCode = isProductType && rawItemCode ? rawItemCode : null;

  return {
    itemType,
    accountCode,
    accountName: accountCode,
    productCode,
    productName: productCode,
    ivaTax: resolveFixedFieldValue(fields.iva),
    retefuenteTax: resolveFixedFieldValue(fields.retefuente),
    paymentMethod: resolveFixedFieldValue(fields.medioPago),
  };
}
