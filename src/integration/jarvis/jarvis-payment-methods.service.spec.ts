import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JarvisPaymentMethodsService } from './jarvis-payment-methods.service';

describe('JarvisPaymentMethodsService', () => {
  const insert = { insert: jest.fn().mockReturnThis(), values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue({}) };
  const repository = { createQueryBuilder: jest.fn(() => insert), create: jest.fn(value => ({ ...value })), save: jest.fn(), find: jest.fn(), findOneBy: jest.fn(), delete: jest.fn() };
  const integrations = { findByCompanyAndProvider: jest.fn() };
  const catalogs = { getPaymentMethods: jest.fn() };
  const service = new JarvisPaymentMethodsService(repository as never, integrations as never, catalogs as never);
  beforeEach(() => {
    jest.clearAllMocks();
    integrations.findByCompanyAndProvider.mockResolvedValue({ id: 'integration' });
    catalogs.getPaymentMethods.mockResolvedValue([{ id: 10, name: 'Efectivo', code: '10' }, { id: 75, name: 'Otro*', code: 'ZZZ' }]);
    repository.save.mockImplementation(async value => ({ ...value, id: 'saved' }));
    repository.findOneBy.mockResolvedValue(null);
  });
  it('valida el catálogo y guarda nombre e identificador maestro por empresa', async () => {
    const response = await service.save('company-a', { name: ' Caja principal ', nextpymeMethodId: 10 });
    expect(response.paymentMethod).toEqual({ id: 'saved', name: 'Caja principal', nextpymeMethodId: 10, nextpymeMethodName: 'Efectivo' });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a' }));
  });
  it.each([0, 999, 1.5])('rechaza identificador maestro inválido %s', async nextpymeMethodId => {
    await expect(service.save('company-a', { name: 'Caja', nextpymeMethodId })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('impide editar formas de otra empresa', async () => {
    await expect(service.save('company-b', { name: 'Caja', nextpymeMethodId: 10 }, 'foreign-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'foreign-id', companyId: 'company-b' });
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('limita listado y eliminación a la empresa activa', async () => {
    repository.find.mockResolvedValue([]);
    repository.delete.mockResolvedValue({ affected: 0 });
    await service.list('company-b');
    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-b' } }));
    await expect(service.remove('company-b', 'foreign-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.delete).toHaveBeenCalledWith({ id: 'foreign-id', companyId: 'company-b' });
  });
  it('rechaza nombres duplicados sin exponer el error de base de datos', async () => {
    repository.save.mockRejectedValue({ code: '23505' });
    await expect(service.save('company-a', { name: 'Caja', nextpymeMethodId: 10 })).rejects.toBeInstanceOf(ConflictException);
  });
  it('crea Efectivo y Otros con IDs reales y protege contra duplicados concurrentes', async () => {
    repository.find.mockResolvedValue([]);
    await service.list('company-a');
    expect(insert.values).toHaveBeenCalledWith([
      { companyId: 'company-a', name: 'Efectivo', nextpymeMethodId: 10, nextpymeMethodName: 'Efectivo' },
      { companyId: 'company-a', name: 'Otros', nextpymeMethodId: 75, nextpymeMethodName: 'Otro*' },
    ]);
    expect(insert.orIgnore).toHaveBeenCalled();
  });
  it('no duplica ni sobrescribe los nombres existentes y ordena Efectivo primero', async () => {
    repository.find.mockResolvedValue([{ id: 'other', name: 'Otros' }, { id: 'custom', name: 'Transferencia' }, { id: 'cash', name: 'efectivo' }]);
    const result = await service.list('company-a');
    expect(result.items.map(item => item.id)).toEqual(['cash', 'other', 'custom']);
    expect(insert.execute).not.toHaveBeenCalled();
    expect(catalogs.getPaymentMethods).not.toHaveBeenCalled();
  });
  it('exige integración Jarvis', async () => {
    integrations.findByCompanyAndProvider.mockResolvedValue(null);
    await expect(service.list('company-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.find).not.toHaveBeenCalled();
  });
});
