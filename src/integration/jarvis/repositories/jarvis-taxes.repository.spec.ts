import { JarvisTaxesRepository } from './jarvis-taxes.repository';

describe('Inicialización del catálogo de impuestos por empresa', () => {
  function setup(initialized: boolean) {
    const insert = { insert: jest.fn().mockReturnThis(), into: jest.fn().mockReturnThis(), values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(), execute: jest.fn() };
    const manager = { query: jest.fn().mockResolvedValue(initialized ? [] : [{ company_id: 'company-a' }]), createQueryBuilder: jest.fn(() => insert) };
    const repository = new JarvisTaxesRepository({ manager: { transaction: (fn: (m: typeof manager) => unknown) => fn(manager) } } as never);
    return { repository, manager, insert };
  }
  it('inserta los valores solo para la empresa e integración solicitadas, sin sobrescribir conflictos', async () => {
    const { repository, manager, insert } = setup(false);
    await repository.ensureDefaults('company-a', 'integration-a');
    expect(manager.query).toHaveBeenCalledWith(expect.any(String), ['company-a']);
    const values = insert.values.mock.calls[0][0];
    expect(values).toHaveLength(28);
    expect(values.every((value: any) => value.companyId === 'company-a' && value.integrationId === 'integration-a')).toBe(true);
    expect(insert.orIgnore).toHaveBeenCalled();
  });
  it('no restablece impuestos modificados o eliminados tras la primera carga', async () => {
    const { repository, manager } = setup(true);
    await repository.ensureDefaults('company-a', 'integration-a');
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });
});
