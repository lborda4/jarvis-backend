import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
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

describe('buscar referencia de factura de compra', () => {
  it.each([' FEV27381 ', 'a'.repeat(96), 'INV_10%'])('filtra consecutivo o CUFE sin buscar en proveedor (%s)', async search => {
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0), getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = new ElectronicDocumentsRepository({ createQueryBuilder: () => query } as never);
    await repository.findAll({ companyId: 'company-1', electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE, search, page: 1, limit: 100 });
    const term = '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%';
    expect(query.andWhere).toHaveBeenCalledWith("(document.cufe ILIKE :term OR document.payload->'invoice'->>'number' ILIKE :term)", { term });
    expect(query.andWhere).toHaveBeenCalledWith('document.companyId = :companyId', { companyId: 'company-1' });
  });
});

describe('supplier siblings without a source document', () => {
  it.each([undefined, '', '  ', '11111111-1111-4111-8111-111111111111'])('handles excluded ID %s without sending an empty UUID to Postgres', async excludeId => {
    const query = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
    const repository = new ElectronicDocumentsRepository({ createQueryBuilder: () => query } as never);
    await repository.findByCompanySupplierAndStatus('company-1', '123456789', ElectronicDocumentStatus.SUPPLIER_NOT_FOUND, excludeId);
    expect(query.where).toHaveBeenCalledWith('document.companyId = :companyId', { companyId: 'company-1' });
    expect(query.andWhere).toHaveBeenCalledWith('document.documentNumberThird = :documentNumberThird', { documentNumberThird: '123456789' });
    expect(query.andWhere).toHaveBeenCalledWith('document.status = :status', { status: ElectronicDocumentStatus.SUPPLIER_NOT_FOUND });
    const exclusions = query.andWhere.mock.calls.filter(([clause]) => clause.includes('excludeId'));
    expect(exclusions).toEqual(excludeId?.trim() ? [['document.id != :excludeId', { excludeId }]] : []);
    expect(query.getMany).toHaveBeenCalled();
  });
});
