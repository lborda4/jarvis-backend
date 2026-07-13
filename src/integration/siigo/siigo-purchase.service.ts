import { Injectable } from '@nestjs/common';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoPurchaseRequestDto } from './dto/siigo-purchase-request.dto';
import { SiigoPurchaseResponse } from './interfaces/siigo-api.interface';

@Injectable()
export class SiigoPurchaseService {
  constructor(private readonly siigoHttpClient: SiigoHttpClient) {}

  async createPurchase(
    accessToken: string,
    payload: SiigoPurchaseRequestDto,
    partnerId?: string,
  ): Promise<SiigoPurchaseResponse> {
    return this.siigoHttpClient.createPurchase(
      accessToken,
      payload,
      partnerId,
    );
  }
}
