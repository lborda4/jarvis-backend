import { Injectable } from '@nestjs/common';
import {
  CreateSiigoPurchaseRequestDto,
  CreateSiigoPurchaseResponseDto,
} from './dto/create-siigo-purchase.dto';
import { SiigoDocumentCreationService } from './siigo-document-creation.service';

@Injectable()
export class SiigoPurchaseCreationService {
  constructor(
    private readonly siigoDocumentCreationService: SiigoDocumentCreationService,
  ) {}

  async createPurchase(
    request: CreateSiigoPurchaseRequestDto,
    companyId: string,
  ): Promise<CreateSiigoPurchaseResponseDto> {
    const result = await this.siigoDocumentCreationService.createInSiigo(
      request.documentId,
      companyId,
    );

    return {
      success: result.success,
      purchase: {
        id: result.siigoDocument.id,
        number: result.siigoDocument.number,
        name: result.siigoDocument.name,
        date: result.siigoDocument.date,
        total: result.siigoDocument.total,
        providerInvoicePrefix: result.siigoDocument.receiptPrefix,
        providerInvoiceNumber: result.siigoDocument.receiptNumber,
      },
      document: result.document,
    };
  }
}
