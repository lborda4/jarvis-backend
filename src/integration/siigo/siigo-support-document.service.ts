import { Injectable } from '@nestjs/common';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoSupportDocumentRequestDto } from './dto/siigo-support-document-request.dto';
import {
  SiigoSupportDocumentDeleteResponse,
  SiigoSupportDocumentResponse,
} from './interfaces/siigo-api.interface';

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

  async deleteSupportDocument(
    accessToken: string,
    siigoSupportDocumentId: string,
    partnerId?: string,
  ): Promise<SiigoSupportDocumentDeleteResponse> {
    return this.siigoHttpClient.deleteSupportDocument(
      accessToken,
      siigoSupportDocumentId,
      partnerId,
    );
  }
}
