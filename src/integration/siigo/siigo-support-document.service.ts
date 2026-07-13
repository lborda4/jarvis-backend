import { Injectable } from '@nestjs/common';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoSupportDocumentRequestDto } from './dto/siigo-support-document-request.dto';
import { SiigoSupportDocumentResponse } from './interfaces/siigo-api.interface';

@Injectable()
export class SiigoSupportDocumentService {
  constructor(private readonly siigoHttpClient: SiigoHttpClient) {}

  async createSupportDocument(
    accessToken: string,
    payload: SiigoSupportDocumentRequestDto,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentResponse> {
    return this.siigoHttpClient.createSupportDocument(
      accessToken,
      payload,
      partnerId,
    );
  }
}
