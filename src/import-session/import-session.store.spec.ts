import { ConfigService } from '@nestjs/config';
import { ImportSessionStore } from './import-session.store';
import { ImportSessionData } from './interfaces/import-session.interface';
import { DianInvoiceResult } from '../dian/interfaces/dian-invoice-result.interface';
import { AppConfiguration } from '../config/configuration';

function buildConfigService(
  ttlSeconds: number,
): ConfigService<AppConfiguration, true> {
  return {
    get: (key: string) => {
      if (key === 'redis.importSessionTtlSeconds') {
        return ttlSeconds;
      }
      if (key === 'redis.url') {
        return undefined;
      }
      throw new Error(`Unexpected config key in test: ${key}`);
    },
  } as unknown as ConfigService<AppConfiguration, true>;
}

describe('ImportSessionStore (memory fallback)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts expired entries from the in-memory map over time', async () => {
    const ttlSeconds = 1;
    const store = new ImportSessionStore(buildConfigService(ttlSeconds));

    const parsedInvoice: DianInvoiceResult = {
      cufe: 'cufe-1',
      numeroFactura: 'FV-1',
      fechaEmision: '2026-01-01',
      moneda: 'COP',
      emisor: { nit: '900123456', nombre: 'Proveedor' },
      receptor: { nit: '900654321', nombre: 'Empresa' },
      items: [],
      totales: { subtotal: 0, total: 0, iva: 0 },
    };
    const session: ImportSessionData = {
      rquid: 'abc',
      parsedInvoice,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.save(session);

    const memoryStore = (store as unknown as { memoryStore: Map<string, unknown> })
      .memoryStore;
    expect(memoryStore.size).toBe(1);

    // Avanza más allá del TTL y del intervalo de limpieza (min(ttl, 5min)).
    jest.advanceTimersByTime(ttlSeconds * 1000 + 1000);

    expect(memoryStore.size).toBe(0);

    await store.onModuleDestroy();
  });
});
