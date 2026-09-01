import { SiigoPaymentTypeCatalogItemDto } from '../dto/list-siigo-payment-types.dto';
import { SupplierPaymentMethodPreference } from '../../interfaces/supplier-mapping-value.interface';

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

  const match = matches[0];

  return {
    id: match.id,
    name: match.name,
    type: match.type,
    dueDate: match.dueDate,
  };
}
