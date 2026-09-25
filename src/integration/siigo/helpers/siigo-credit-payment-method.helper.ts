import { SiigoPaymentTypeCatalogItemDto } from '../dto/list-siigo-payment-types.dto';
import { SupplierPaymentMethodPreference } from '../../interfaces/supplier-mapping-value.interface';

const CREDIT_SUPPLIER_NAME_ALIASES = [
  'credito proveedores',
  'credito a proveedores',
] as const;

const OTHER_PAYABLES_NAME_ALIASES = [
  'otras cuentas por pagar',
] as const;

/**
 * Sugiere un medio de pago a partir de si la factura es de contado o crédito
 * (dato que sí trae DIAN de forma confiable, a diferencia del método de pago
 * específico — transferencia/efectivo/etc — que es un catálogo libre de cada
 * empresa en SIIGO sin relación con los códigos DIAN). Solo sugiere cuando
 * hay EXACTAMENTE UN medio de pago del tipo correspondiente en el catálogo:
 * con más de uno no hay forma de saber cuál de todos usar, y es preferible
 * dejarlo vacío a elegir mal.
 */
export function resolveCreditFallbackPaymentMethod(
  isCreditPayment: boolean | undefined,
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
): SupplierPaymentMethodPreference | null {
  if (isCreditPayment === undefined) {
    return null;
  }

  const matches = paymentTypesCatalog.filter(
    (paymentType) => paymentType.dueDate === isCreditPayment,
  );

  if (matches.length !== 1) {
    return null;
  }

  return toPaymentMethodPreference(matches[0]);
}

/**
 * Factura de compra sin historial de medio de pago: siempre crédito.
 * El id es el del catálogo SIIGO de ESA empresa (cambia por tenant);
 * se busca por nombre. Cuenta 5 → Otras cuentas por pagar; 1/6/7 u
 * otra/sin cuenta → Crédito proveedores.
 */
export function resolvePurchaseCreditFallbackPaymentMethod(
  accountCode: string | null | undefined,
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
): SupplierPaymentMethodPreference | null {
  const accountClass = resolveAccountClass(accountCode);
  const aliases =
    accountClass === '5' ? OTHER_PAYABLES_NAME_ALIASES : CREDIT_SUPPLIER_NAME_ALIASES;

  return (
    findPaymentTypeByName(paymentTypesCatalog, aliases) ??
    findFirstCreditPaymentType(paymentTypesCatalog)
  );
}

function resolveAccountClass(accountCode: string | null | undefined): string | null {
  const digits = accountCode?.replace(/[^\d]/g, '') ?? '';
  return digits[0] ?? null;
}

function findPaymentTypeByName(
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
  aliases: readonly string[],
): SupplierPaymentMethodPreference | null {
  const match = paymentTypesCatalog.find((paymentType) => {
    const normalized = normalizePaymentName(paymentType.name);
    return aliases.some(
      (alias) => normalized === alias || normalized.includes(alias),
    );
  });

  return match ? toPaymentMethodPreference(match) : null;
}

function findFirstCreditPaymentType(
  paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
): SupplierPaymentMethodPreference | null {
  const match = paymentTypesCatalog.find(
    (paymentType) => paymentType.dueDate === true,
  );

  return match ? toPaymentMethodPreference(match) : null;
}

function normalizePaymentName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function toPaymentMethodPreference(
  paymentType: SiigoPaymentTypeCatalogItemDto,
): SupplierPaymentMethodPreference {
  return {
    id: paymentType.id,
    name: paymentType.name,
    type: paymentType.type,
    dueDate: paymentType.dueDate,
  };
}
