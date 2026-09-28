import { BoldCashRegistersService } from './bold-cash-registers.service';
import { SiigoBoldCashRegistersRepository } from './repositories/siigo-bold-cash-registers.repository';

describe('Bold cajas solo por nombre', () => {
  it('guarda sin exigir sucursal ni ID de caja', async () => {
    const repository = {
      upsert: jest
        .fn()
        .mockResolvedValue({
          id: 'mapping',
          cashRegisterName: 'Caja principal',
          boldTerminalId: 'serial',
        }),
    };
    const terminals = {
      getBindedTerminals: jest
        .fn()
        .mockResolvedValue({
          payload: {
            available_terminals: [
              { terminal_serial: 'serial', status: 'BINDED' },
            ],
          },
        }),
    };
    const service = new BoldCashRegistersService(
      terminals as never,
      repository as never,
    );
    await service.upsert({
      companyId: 'company',
      cashRegisterName: 'Caja principal',
      boldTerminalId: 'serial',
    });
    expect(repository.upsert).toHaveBeenCalledWith({
      id: undefined,
      companyId: 'company',
      cashRegisterName: 'Caja principal',
      boldTerminalId: 'serial',
    });
  });

  it('crea con identificadores antiguos nulos', async () => {
    const orm = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn((data) => data),
    };
    const repository = new SiigoBoldCashRegistersRepository(orm as never);
    const data = {
      companyId: 'company',
      cashRegisterName: 'Principal',
      boldTerminalId: 'serial',
    };
    await repository.upsert(data);
    expect(orm.save).toHaveBeenCalledWith({
      ...data,
      branchOfficeId: null,
      cashRegisterId: null,
    });
  });

  it('renombra la caja conservando su ID y los datos anteriores', async () => {
    const previous = {
      id: 'mapping',
      companyId: 'company',
      branchOfficeId: 2,
      cashRegisterId: 'old',
      cashRegisterName: 'Anterior',
      boldTerminalId: 'serial',
    };
    const orm = {
      findOne: jest.fn().mockResolvedValue(previous),
      create: jest.fn((data) => data),
      save: jest.fn((data) => data),
    };
    const repository = new SiigoBoldCashRegistersRepository(orm as never);
    await repository.upsert({
      id: 'mapping',
      companyId: 'company',
      cashRegisterName: 'Nueva',
      boldTerminalId: 'serial',
    });
    expect(orm.findOne).toHaveBeenCalledWith({
      where: { id: 'mapping', companyId: 'company' },
    });
    expect(orm.save).toHaveBeenCalledWith({
      ...previous,
      cashRegisterName: 'Nueva',
    });
  });

  it('rechaza editar una caja ajena a la empresa', async () => {
    const orm = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
    const repository = new SiigoBoldCashRegistersRepository(orm as never);
    await expect(
      repository.upsert({
        id: 'other-company-mapping',
        companyId: 'company',
        cashRegisterName: 'Principal',
        boldTerminalId: 'serial',
      }),
    ).rejects.toThrow();
    expect(orm.save).not.toHaveBeenCalled();
  });
});
