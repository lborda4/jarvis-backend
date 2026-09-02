import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';

function buildService(): SiigoDocumentPreparationService {
  return new SiigoDocumentPreparationService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('SiigoDocumentPreparationService.prepareDocuments', () => {
  it('nunca procesa más documentos en simultáneo que el límite de concurrencia acotada', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    let inFlight = 0;
    let maxInFlight = 0;

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        return { documentId, nextStep: 'READY' } as any;
      });

    const documentIds = Array.from({ length: 23 }, (_, i) => `doc-${i}`);
    await service.prepareDocuments(documentIds, 'company-1');

    expect(service.prepareSupplierAndAccounts).toHaveBeenCalledTimes(23);
    // Un import de 500+ filas no debe disparar 500+ llamadas en paralelo
    // contra SIIGO — este es el assert que revienta si alguien vuelve a un
    // Promise.all sin límite.
    expect(maxInFlight).toBeLessThanOrEqual(5);
    // Pero tampoco se volvió secuencial: sí hay trabajo en paralelo.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('un documento que falla no bloquea ni detiene al resto del lote', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});

    jest
      .spyOn(service, 'prepareSupplierAndAccounts')
      .mockImplementation(async (documentId: string) => {
        if (documentId === 'doc-2') {
          throw new Error('fallo puntual de SIIGO');
        }

        return { documentId, nextStep: 'READY' } as any;
      });

    const documentIds = ['doc-1', 'doc-2', 'doc-3'];
    await service.prepareDocuments(documentIds, 'company-1');

    expect(service.prepareSupplierAndAccounts).toHaveBeenCalledTimes(3);
  });

  it('procesa un lote vacío sin errores', async () => {
    const service = buildService();
    jest.spyOn(service as any, 'createBatchContext').mockResolvedValue({});
    const spy = jest.spyOn(service, 'prepareSupplierAndAccounts');

    await expect(
      service.prepareDocuments([], 'company-1'),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
