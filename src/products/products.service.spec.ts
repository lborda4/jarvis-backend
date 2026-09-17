import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';

function buildTax(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tax-1',
    code: '111',
    name: 'IVA Venta 19%',
    taxType: 'IVA',
    rate: '19',
    ...overrides,
  };
}

function buildService(overrides: {
  findByCompanyAndSku?: jest.Mock;
  findByIdAndCompany?: jest.Mock;
  findByIdsAndCompany?: jest.Mock;
  findCategoryByIdAndCompany?: jest.Mock;
  save?: jest.Mock;
} = {}) {
  const productsRepository = {
    create: jest.fn().mockImplementation((entity) => entity),
    save: overrides.save ?? jest.fn().mockImplementation((entity) => ({
      ...entity,
      id: 'product-1',
    })),
    findByCompanyAndSku:
      overrides.findByCompanyAndSku ?? jest.fn().mockResolvedValue(null),
    findByIdAndCompany:
      overrides.findByIdAndCompany ??
      jest.fn().mockImplementation((id, companyId) =>
        Promise.resolve({
          id,
          companyId,
          sku: 'PROD-001',
          name: 'Camisa',
          kind: 'product',
          unit: '94',
          categoryId: null,
          category: null,
          description: null,
          taxes: [],
          priceLists: [],
        }),
      ),
    findSkusByCompanyAndPrefix: jest.fn().mockResolvedValue([]),
  };
  const categoriesRepository = {
    findByIdAndCompany:
      overrides.findCategoryByIdAndCompany ?? jest.fn().mockResolvedValue(null),
  };
  const companiesRepository = {
    findById: jest.fn().mockResolvedValue(null),
  };
  const masterCatalogService = {
    getUnitMeasures: jest.fn().mockResolvedValue([]),
  };
  const jarvisTaxesRepository = {
    findByIdsAndCompany:
      overrides.findByIdsAndCompany ?? jest.fn().mockResolvedValue([]),
  };

  const service = new ProductsService(
    productsRepository as any,
    categoriesRepository as any,
    companiesRepository as any,
    masterCatalogService as any,
    jarvisTaxesRepository as any,
  );

  return { service, productsRepository, jarvisTaxesRepository };
}

function buildValidRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sku: 'PROD-001',
    name: 'Camisa',
    kind: 'product',
    unit: '94',
    priceLists: [
      { position: 1, name: 'Precio general', price: 50000, enabled: true },
    ],
    ...overrides,
  } as any;
}

describe('ProductsService.create', () => {
  it('crea el producto asociando los impuestos/retenciones elegidos del catálogo real de la empresa', async () => {
    const findByIdsAndCompany = jest
      .fn()
      .mockResolvedValue([buildTax({ id: 'tax-1' }), buildTax({ id: 'tax-2' })]);
    const { service, productsRepository } = buildService({
      findByIdsAndCompany,
    });

    await service.create(
      buildValidRequest({ taxIds: ['tax-1', 'tax-2'] }),
      'company-1',
    );

    expect(findByIdsAndCompany).toHaveBeenCalledWith(
      ['tax-1', 'tax-2'],
      'company-1',
    );
    expect(productsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taxes: [buildTax({ id: 'tax-1' }), buildTax({ id: 'tax-2' })],
      }),
    );
  });

  it('caso real pedido: guarda priceIncludesIva como un checkbox simple del producto', async () => {
    const { service, productsRepository } = buildService();

    await service.create(
      buildValidRequest({ priceIncludesIva: true }),
      'company-1',
    );

    expect(productsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ priceIncludesIva: true }),
    );
  });

  it('priceIncludesIva por defecto es false si no se envía', async () => {
    const { service, productsRepository } = buildService();

    await service.create(buildValidRequest(), 'company-1');

    expect(productsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ priceIncludesIva: false }),
    );
  });

  it('caso real pedido: rechaza si algún impuesto/retención elegido no existe (o es de otra empresa)', async () => {
    const { service } = buildService({
      findByIdsAndCompany: jest.fn().mockResolvedValue([buildTax({ id: 'tax-1' })]),
    });

    await expect(
      service.create(
        buildValidRequest({ taxIds: ['tax-1', 'tax-inexistente'] }),
        'company-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite crear un producto sin ningún impuesto/retención asociado', async () => {
    const findByIdsAndCompany = jest.fn().mockResolvedValue([]);
    const { service, productsRepository } = buildService({ findByIdsAndCompany });

    await service.create(buildValidRequest(), 'company-1');

    expect(findByIdsAndCompany).not.toHaveBeenCalled();
    expect(productsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ taxes: [] }),
    );
  });

  it('rechaza un SKU ya usado en la misma empresa', async () => {
    const { service } = buildService({
      findByCompanyAndSku: jest.fn().mockResolvedValue({ id: 'existing' }),
    });

    await expect(
      service.create(buildValidRequest(), 'company-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza sin al menos una lista de precios activa', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        buildValidRequest({
          priceLists: [
            { position: 1, name: 'Precio general', price: 50000, enabled: false },
          ],
        }),
        'company-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
