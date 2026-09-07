export class BoldPaymentMethodDto {
  name: string;
  enabled: boolean;
}

/** Forma tal cual la devuelve GET /payments/payment-methods de Bold. */
export class BoldPaymentMethodsResponseDto {
  payload: {
    payment_methods: BoldPaymentMethodDto[];
  };
  errors: unknown[];
}
