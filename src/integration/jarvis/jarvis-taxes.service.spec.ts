import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JarvisTaxesService } from './jarvis-taxes.service';
import { JarvisTaxCategory } from './enums/jarvis-tax-category.enum';

function buildTax(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tax-1',
    companyId: 'company-1',
    integrationId: 'integration-1',
    category: JarvisTaxCategory.IMPUESTO,
    code: '111',
    name: 'IVA Venta 19%',
    taxType: 'IVA',
    rate: '19',
    isActive: true,
    isInUse: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(overrides: {
  findByCompany?: jest.Mock;
  findById?: jest.Mock;
  findByCompanyAndCode?: jest.Mock;
  findByCompanyAndCodeExcludingId?: jest.Mock;
  findNextAvailableCode?: jest.Mock;
  save?: jest.Mock;
  remove?: jest.Mock;
} = {}) {
  const integrationsRepository = {
    findByCompanyAndProvider: jest
      .fn()
      .mockResolvedValue({ id: 'integration-1' }),
  };
  const jarvisTaxesRepository = {
    findByCompany: overrides.findByCompany ?? jest.fn().mockResolvedValue([]),
    findById: overrides.findById ?? jest.fn().mockResolvedValue(null),
    findByCompanyAndCode:
      overrides.findByCompanyAndCode ?? jest.fn().mockResolvedValue(null),
    findByCompanyAndCodeExcludingId:
      overrides.findByCompanyAndCodeExcludingId ??
      jest.fn().mockResolvedValue(null),
    findNextAvailableCode:
      overrides.findNextAvailableCode ?? jest.fn().mockResolvedValue('1'),
    create: jest.fn().mockImplementation((entity) => entity),
    save: overrides.save ?? jest.fn().mockImplementation((entity) => buildTax(entity)),
    remove: overrides.remove ?? jest.fn().mockResolvedValue(undefined),
  };

  const service = new JarvisTaxesService(
    integrationsRepository as any,
    jarvisTaxesRepository as any,
  );

  return { service, integrationsRepository, jarvisTaxesRepository };
}

describe('JarvisTaxesService.create', () => {
  it('crea un impuesto autogenerando el código — el cliente ya no lo envía (pedido explícito: solo elige el nombre)', async () => {
    const findNextAvailableCode = jest.fn().mockResolvedValue('112');
    const { service, jarvisTaxesRepository } = buildService({
      findNextAvailableCode,
    });

    const result = await service.create(
      {
        category: JarvisTaxCategory.IMPUESTO,
        name: 'IVA Venta 19%',
        tax_type: 'IVA',
        rate: 19,
      },
      'company-1',
    );

    expect(result.success).toBe(true);
    expect(result.tax.code).toBe('112');
    expect(result.tax.rate).toBe(19);
    expect(findNextAvailableCode).toHaveBeenCalledWith('company-1');
    expect(jarvisTaxesRepository.save).toHaveBeenCalled();
  });

  it('nace siempre Activo, sin que el cliente pueda elegirlo al crear', async () => {
    const { service } = buildService();

    const result = await service.create(
      {
        category: JarvisTaxCategory.IMPUESTO,
        name: 'IVA Venta 19%',
        tax_type: 'IVA',
      },
      'company-1',
    );

    expect(result.tax.is_active).toBe(true);
  });

  it('si el código calculado ya está tomado (carrera con otra creación), reintenta una vez con el siguiente', async () => {
    const findNextAvailableCode = jest
      .fn()
      .mockResolvedValueOnce('112')
      .mockResolvedValueOnce('113');
    const findByCompanyAndCode = jest
      .fn()
      .mockResolvedValueOnce(buildTax({ code: '112' }));
    const { service, jarvisTaxesRepository } = buildService({
      findNextAvailableCode,
      findByCompanyAndCode,
    });

    const result = await service.create(
      {
        category: JarvisTaxCategory.IMPUESTO,
        name: 'IVA Venta 19%',
        tax_type: 'IVA',
      },
      'company-1',
    );

    expect(result.tax.code).toBe('113');
    expect(findNextAvailableCode).toHaveBeenCalledTimes(2);
    expect(jarvisTaxesRepository.save).toHaveBeenCalled();
  });

  it('rechaza una categoría distinta de IMPUESTO/RETENCION', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        {
          category: 'OTRA' as JarvisTaxCategory,
          name: 'IVA Venta 19%',
          tax_type: 'IVA',
        },
        'company-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caso real pedido: ReteICA nunca guarda tarifa manual, se divide en mil por defecto — ignora la tarifa aunque venga en la petición', async () => {
    const { service } = buildService();

    const result = await service.create(
      {
        category: JarvisTaxCategory.RETENCION,
        name: 'ReteICA',
        tax_type: 'ReteICA',
        rate: 11,
      },
      'company-1',
    );

    expect(result.tax.rate).toBeNull();
  });

  it('rechaza nombre o tipo vacíos', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        {
          category: JarvisTaxCategory.IMPUESTO,
          name: '   ',
          tax_type: 'IVA',
        },
        'company-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('JarvisTaxesService.list', () => {
  it('filtra por categoría, búsqueda y estado', async () => {
    const findByCompany = jest.fn().mockResolvedValue([buildTax()]);
    const { service } = buildService({ findByCompany });

    const result = await service.list(
      'company-1',
      JarvisTaxCategory.IMPUESTO,
      'IVA',
      true,
    );

    expect(result.total).toBe(1);
    expect(findByCompany).toHaveBeenCalledWith('company-1', {
      search: 'IVA',
      isActive: true,
      category: JarvisTaxCategory.IMPUESTO,
    });
  });

  it('rechaza una categoría inválida en el filtro', async () => {
    const { service } = buildService();

    await expect(service.list('company-1', 'OTRA')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('JarvisTaxesService.update', () => {
  it('actualiza los campos enviados y conserva el resto', async () => {
    const existing = buildTax();
    const { service, jarvisTaxesRepository } = buildService({
      findById: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.update(
      'tax-1',
      { name: 'IVA Venta 19% (editado)', is_active: false },
      'company-1',
    );

    expect(result.tax.name).toBe('IVA Venta 19% (editado)');
    expect(result.tax.is_active).toBe(false);
    expect(result.tax.code).toBe('111');
    expect(jarvisTaxesRepository.save).toHaveBeenCalled();
  });

  it('falla si el impuesto no existe en la empresa', async () => {
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.update('tax-1', { name: 'x' }, 'company-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('caso real pedido: cambiar el tipo a ReteICA borra la tarifa que tuviera antes', async () => {
    const existing = buildTax({ taxType: 'IVA', rate: '19' });
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.update(
      'tax-1',
      { tax_type: 'ReteICA' },
      'company-1',
    );

    expect(result.tax.rate).toBeNull();
  });

  it('rechaza cambiar a un código que ya usa otro impuesto', async () => {
    const existing = buildTax();
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(existing),
      findByCompanyAndCodeExcludingId: jest
        .fn()
        .mockResolvedValue(buildTax({ id: 'tax-2', code: '112' })),
    });

    await expect(
      service.update('tax-1', { code: '112' }, 'company-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('JarvisTaxesService.remove', () => {
  it('elimina el impuesto de la empresa', async () => {
    const existing = buildTax();
    const remove = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(existing),
      remove,
    });

    const result = await service.remove('tax-1', 'company-1');

    expect(result.success).toBe(true);
    expect(remove).toHaveBeenCalledWith(existing);
  });

  it('falla si el impuesto no existe en la empresa', async () => {
    const { service } = buildService({
      findById: jest.fn().mockResolvedValue(null),
    });

    await expect(service.remove('tax-1', 'company-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
