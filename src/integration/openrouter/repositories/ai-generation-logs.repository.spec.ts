import { AiGenerationLogsRepository } from './ai-generation-logs.repository';
import { ElectronicDocument } from '../../../electronic-document/entities/electronic-document.entity';

function setup() {
  const document = {
    id: 'doc-1', companyId: 'company-1',
    payload: { items: [{ descripcion: 'Servicio' }], aiSuggestion: undefined as any },
  };
  const documents = {
    findOne: jest.fn().mockResolvedValue(document),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(documents) };
  const logs = {
    findOne: jest.fn().mockResolvedValue({ documentId: 'doc-1', companyId: 'company-1' }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: { transaction: jest.fn(async (work) => work(manager)) },
  };
  return { repository: new AiGenerationLogsRepository(logs as never), document, documents, logs, manager };
}

describe('Costo de IA en payload.aiSuggestion', () => {
  it('acumula peticiones y reemplaza el costo definitivo sin duplicarlo', async () => {
    const { repository, document, logs, documents, manager } = setup();
    await repository.markCompleted('req-1', { totalCost: 0.00001234 });
    await repository.markCompleted('req-2', { totalCost: 0.00002 });
    await repository.enrich('req-1', { totalCost: 0.000015 });
    await repository.enrich('req-1', { totalCost: 0.000015 });
    expect(document.payload.aiSuggestion).toEqual({
      totalCost: 0.000035, currency: 'USD', retentions: [],
      costsByRequest: { 'req-1': 0.000015, 'req-2': 0.00002 },
    });
    expect(document.payload.items).toEqual([{ descripcion: 'Servicio' }]);
    expect(logs.update.mock.calls.every(([, update]) => !('totalCost' in update))).toBe(true);
    expect(manager.getRepository).toHaveBeenCalledWith(ElectronicDocument);
    expect(documents.findOne).toHaveBeenCalledWith({
      where: { id: 'doc-1', companyId: 'company-1' }, lock: { mode: 'pessimistic_write' },
    });
  });

  it('conserva cero como costo real y no lo confunde con costo desconocido', async () => {
    const { repository, document, documents } = setup();
    await repository.recordCost('free', 0);
    await repository.enrich('free', { totalCost: null });
    expect(document.payload.aiSuggestion.totalCost).toBe(0);
    expect(documents.update).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, -1, NaN, Infinity])('ignora costos inválidos (%s)', async (cost) => {
    const { repository, logs } = setup();
    await repository.recordCost('req-1', cost);
    expect(logs.manager.transaction).not.toHaveBeenCalled();
  });

  it('no actualiza documentos sin empresa identificada', async () => {
    const { repository, logs } = setup();
    logs.findOne.mockResolvedValue({ documentId: 'doc-1' });
    await repository.recordCost('req-1', 0.1);
    expect(logs.manager.transaction).not.toHaveBeenCalled();
  });

  it('un fallo al guardar el costo no impide utilizar la respuesta de IA', async () => {
    const { repository, documents } = setup();
    documents.update.mockRejectedValue(new Error('DB unavailable'));
    await expect(repository.recordCost('req-1', 0.1)).resolves.toBeUndefined();
  });
});
