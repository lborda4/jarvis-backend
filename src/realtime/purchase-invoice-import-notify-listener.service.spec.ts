import { Client } from 'pg';
import { PurchaseInvoiceImportNotifyListenerService } from './purchase-invoice-import-notify-listener.service';

jest.mock('pg', () => ({ Client: jest.fn() }));

describe('conexión de progreso por suscripción', () => {
  it('no conecta estando inactivo ni programa reconexiones al fallar', async () => {
    jest.useFakeTimers();
    try {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const client = {
        on: jest.fn((event: string, handler: (...args: any[]) => void) => { handlers[event] = handler; }),
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
      };
      (Client as unknown as jest.Mock).mockImplementation(() => client);
      const gateway = { beforeSubscribe: undefined as undefined | (() => Promise<void>) };
      const service = new PurchaseInvoiceImportNotifyListenerService(
        { get: () => 'postgres://test' } as never, gateway as never,
      );
      await jest.advanceTimersByTimeAsync(600000);
      expect(client.connect).not.toHaveBeenCalled();
      await gateway.beforeSubscribe!();
      expect(client.connect).toHaveBeenCalledTimes(1);
      handlers.error(new Error('desconectado'));
      await jest.advanceTimersByTimeAsync(600000);
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      await gateway.beforeSubscribe!();
      expect(client.connect).toHaveBeenCalledTimes(2);
      service.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });
});
