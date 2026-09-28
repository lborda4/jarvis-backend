import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoHttpClient } from './clients/siigo-http.client';

const auth = {} as SiigoAuthService;
const http = {} as SiigoHttpClient;

describe('manual SIIGO catalog refresh', () => {
  it('bypasses fresh product cache and retains the new result for subsequent reads', async () => {
    const service = new SiigoProductsCatalogService(auth, http);
    const fetcher = jest.spyOn(service as unknown as {
      fetchProductsFromSiigo: (id: string) => Promise<unknown[]>;
    }, 'fetchProductsFromSiigo');
    const oldItems = [{ id: 'old' }];
    const newItems = [{ id: 'new' }];
    fetcher.mockResolvedValueOnce(oldItems).mockResolvedValueOnce(newItems);
    expect(await service.listProducts('company')).toBe(oldItems);
    expect(await service.listProducts('company')).toBe(oldItems);
    expect(await service.listProducts('company', true)).toBe(newItems);
    expect(await service.listProducts('company')).toBe(newItems);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(new Error('SIIGO unavailable'));
    await expect(service.listProducts('company', true)).rejects.toThrow('SIIGO unavailable');
    expect(await service.listProducts('company')).toBe(newItems);
  });

  it('bypasses fresh cost center cache and retains the new result for subsequent reads', async () => {
    const service = new SiigoCostCentersCatalogService(auth, http);
    const fetcher = jest.spyOn(service as unknown as {
      fetchCostCentersFromSiigo: (id: string) => Promise<unknown[]>;
    }, 'fetchCostCentersFromSiigo');
    const oldItems = [{ id: 1 }];
    const newItems = [{ id: 2 }];
    fetcher.mockResolvedValueOnce(oldItems).mockResolvedValueOnce(newItems);
    expect(await service.listCostCenters('company')).toBe(oldItems);
    expect(await service.listCostCenters('company')).toBe(oldItems);
    expect(await service.listCostCenters('company', true)).toBe(newItems);
    expect(await service.listCostCenters('company')).toBe(newItems);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(new Error('SIIGO unavailable'));
    await expect(service.listCostCenters('company', true)).rejects.toThrow('SIIGO unavailable');
    expect(await service.listCostCenters('company')).toBe(newItems);
  });
});