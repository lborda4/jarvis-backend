import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ElectronicDocumentService } from './electronic-document.service';
jest.mock('../common/helpers/postgres-advisory-lock.helper', () => ({ withPostgresAdvisoryLock: jest.fn((_source, _key, fn) => fn()) }));
describe('Bloqueo al actualizar compras', () => {
  function setup() {
    const service = Object.create(ElectronicDocumentService.prototype) as ElectronicDocumentService;
    Object.assign(service, { documentCreationInFlight: new Map(), dataSource: {}, requireById: jest.fn(async () => ({ electronicDocumentType: 'PURCHASE_INVOICE', status: 'PURCHASE_CREATED', siigoPurchaseId: 'remote' })) });
    return service;
  }
  it('impide dos modificaciones simultáneas y libera el bloqueo al terminar', async () => {
    const service=setup(); let release!: () => void;
    const gate=new Promise<void>(resolve => {release=resolve});
    const first=service.runExclusiveForPurchaseUpdate('doc','company','remote',() => gate);
    const second=jest.fn();
    await expect(service.runExclusiveForPurchaseUpdate('doc','company','remote',second)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(second).not.toHaveBeenCalled(); release(); await first;
    await service.runExclusiveForPurchaseUpdate('doc','company','remote',async()=> 'done');
  });
  it('también bloquea compras externas al revalidar dentro del bloqueo', async () => {
    const service=setup(); const update=jest.fn();
    jest.spyOn(service, 'requireById').mockResolvedValue({ electronicDocumentType: 'PURCHASE_INVOICE', status: 'PURCHASE_CREATED', siigoPurchaseId: 'remote', alreadyInSiigo: true } as never);
    await expect(service.runExclusiveForPurchaseUpdate('doc','company','remote',update)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
  it('revalida el vínculo a SIIGO después de adquirir el bloqueo', async()=>{
    const service=setup(); const update=jest.fn();
    await expect(service.runExclusiveForPurchaseUpdate('doc','company','another',update)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(service.requireById).toHaveBeenCalledWith('doc','company','SIIGO');
    await expect(service.runExclusiveForPurchaseUpdate('doc','company','remote',async()=> 'done')).resolves.toBe('done');
  });
});
