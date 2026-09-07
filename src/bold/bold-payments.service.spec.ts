import { BoldPaymentsService } from './bold-payments.service';
import { BOLD_PAYMENT_METHODS_MOCK } from './mocks/bold-payment-methods.mock';

describe('BoldPaymentsService.getPaymentMethods', () => {
  it('devuelve el mock cuando Bold no está configurado (sin credenciales todavía)', async () => {
    const boldHttpClient = {
      isConfigured: jest.fn().mockReturnValue(false),
      getPaymentMethods: jest.fn(),
    };
    const service = new BoldPaymentsService(boldHttpClient as never);

    const result = await service.getPaymentMethods();

    expect(result).toEqual(BOLD_PAYMENT_METHODS_MOCK);
    expect(boldHttpClient.getPaymentMethods).not.toHaveBeenCalled();
  });

  it('llama a la API real cuando Bold sí está configurado', async () => {
    const realResponse = {
      payload: { payment_methods: [{ name: 'POS', enabled: true }] },
      errors: [],
    };
    const boldHttpClient = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPaymentMethods: jest.fn().mockResolvedValue(realResponse),
    };
    const service = new BoldPaymentsService(boldHttpClient as never);

    const result = await service.getPaymentMethods();

    expect(result).toEqual(realResponse);
    expect(boldHttpClient.getPaymentMethods).toHaveBeenCalledTimes(1);
  });
});
