import { BoldPaymentMethodsResponseDto } from '../dto/bold-payment-methods.dto';

/**
 * Respuesta real de ejemplo que compartió Bold para GET
 * /payments/payment-methods — se usa mientras no tengamos credenciales
 * (BoldHttpClient.isConfigured() === false, ver BoldPaymentsService).
 * Reemplazar/borrar cuando la API real esté conectada.
 */
export const BOLD_PAYMENT_METHODS_MOCK: BoldPaymentMethodsResponseDto = {
  payload: {
    payment_methods: [
      { name: 'NEQUI', enabled: true },
      { name: 'PAY_BY_LINK', enabled: true },
      { name: 'POS', enabled: true },
      { name: 'PAY_BY_QR_BOLD', enabled: true },
    ],
  },
  errors: [],
};
