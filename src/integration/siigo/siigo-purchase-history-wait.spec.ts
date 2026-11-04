import { SiigoPurchaseHistorySyncService } from './siigo-purchase-history-sync.service';
import { SiigoPurchaseSyncJobStatus } from '../enums/siigo-purchase-sync-job-status.enum';

describe('espera del historial sin consultas periódicas', () => {
  function setup() {
    const service = Object.create(SiigoPurchaseHistorySyncService.prototype) as SiigoPurchaseHistorySyncService;
    const runningSyncs = new Map<string, Promise<void>>();
    Object.assign(service, { runningSyncs });
    jest.spyOn(service, 'startSync').mockResolvedValue({ jobId: 'sync' });
    const status = jest.spyOn(service, 'getLatestStatus').mockResolvedValue({
      id: 'sync', status: SiigoPurchaseSyncJobStatus.COMPLETED,
    } as never);
    return { service, runningSyncs, status };
  }

  it('espera la finalización y lee el resultado una sola vez', async () => {
    jest.useFakeTimers();
    try {
      const { service, runningSyncs, status } = setup();
      let complete!: () => void;
      runningSyncs.set('sync', new Promise<void>(resolve => { complete = resolve; }));
      const work = service.syncAndWait('company');
      await jest.advanceTimersByTimeAsync(600000);
      expect(status).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      complete();
      await work;
      expect(status).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('propaga el error del sync antes de que se procese la importación', async () => {
    const { service, status } = setup();
    status.mockResolvedValue({
      id: 'sync', status: SiigoPurchaseSyncJobStatus.ERROR,
      errorMessage: 'SIIGO no disponible',
    } as never);
    await expect(service.syncAndWait('company')).rejects.toThrow('SIIGO no disponible');
  });
});
