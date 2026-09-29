import { ElectronicDocumentsRepository } from './electronic-documents.repository';
import { ElectronicDocument } from '../entities/electronic-document.entity';

it('conserva costos definitivos al guardar un payload leído antes del enriquecimiento', async () => {
  const aiSuggestion = {
    retentions: [], currency: 'USD', totalCost: 0.00015,
    costsByRequest: { 'req-1': 0.00015 },
  };
  const documents = {
    findOne: jest.fn().mockResolvedValue({ payload: { aiSuggestion } }),
    save: jest.fn(async (value) => value),
  };
  const repository = new ElectronicDocumentsRepository({
    manager: { transaction: async (work) => work({ getRepository: () => documents }) },
  } as never);
  const saved = await repository.save({
    id: 'doc-1', companyId: 'company-1',
    payload: { items: [{ descripcion: 'Actualizado' }] },
  } as ElectronicDocument);
  expect(saved.payload.aiSuggestion).toEqual(aiSuggestion);
  expect(saved.payload.items[0].descripcion).toBe('Actualizado');
  expect(documents.findOne).toHaveBeenCalledWith({
    where: { id: 'doc-1', companyId: 'company-1' }, lock: { mode: 'pessimistic_write' },
  });
});
describe('import batch document filters', () => {
  it('combines exact document IDs with authenticated company scope', async () => {
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(), getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = new ElectronicDocumentsRepository({ createQueryBuilder: () => query } as never);
    await repository.findAll({ companyId: 'company-1', documentIds: ['old-reused-document'], page: 1, limit: 100 });
    expect(query.andWhere).toHaveBeenCalledWith('document.companyId = :companyId', { companyId: 'company-1' });
    expect(query.andWhere).toHaveBeenCalledWith('document.id IN (:...documentIds)', { documentIds: ['old-reused-document'] });
  });
});
