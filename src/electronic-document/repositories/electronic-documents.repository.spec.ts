import { ElectronicDocumentsRepository } from './electronic-documents.repository';
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
