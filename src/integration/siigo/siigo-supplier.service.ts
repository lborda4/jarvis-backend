import { Injectable } from '@nestjs/common';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoSupplierRequestDto } from './dto/siigo-supplier-request.dto';
import { SiigoCustomer } from './interfaces/siigo-api.interface';

@Injectable()
export class SiigoSupplierService {
  constructor(private readonly siigoHttpClient: SiigoHttpClient) {}

  async findSupplierByNit(
    accessToken: string,
    nit: string,
    branchOffice = 0,
    partnerId?: string,
  ): Promise<SiigoCustomer | null> {
    const normalizedNit = nit.replace(/[^\d]/g, '');

    console.log('[SIIGO supplier] findSupplierByNit', {
      inputNit: nit,
      normalizedNit,
      branchOffice,
    });

    const result = await this.siigoHttpClient.findCustomerByIdentificationAndBranch(
      accessToken,
      normalizedNit,
      branchOffice,
      partnerId,
    );

    console.log('[SIIGO supplier] findSupplierByNit - result', {
      normalizedNit,
      found: Boolean(result),
      supplierName: result?.commercial_name ?? result?.name?.[0],
    });

    return result;
  }

  async createSupplier(
    accessToken: string,
    payload: SiigoSupplierRequestDto,
    partnerId?: string,
  ): Promise<SiigoCustomer> {
    return this.siigoHttpClient.createCustomer(
      accessToken,
      payload,
      partnerId,
    );
  }
}
