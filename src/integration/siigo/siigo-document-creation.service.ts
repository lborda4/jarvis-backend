import { BadRequestException, Injectable } from '@nestjs/common';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { CreateSiigoDocumentResponseDto } from './dto/create-siigo-document.dto';
import { SiigoDocumentCreationRegistry } from './siigo-document-creation.registry';

@Injectable()
export class SiigoDocumentCreationService {
  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly documentCreationRegistry: SiigoDocumentCreationRegistry,
  ) {}

  async createInSiigo(
    documentId: string,
    companyId: string,
  ): Promise<CreateSiigoDocumentResponseDto> {
    const trimmedId = documentId?.trim();

    if (!trimmedId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    const electronicDocument =
      await this.electronicDocumentService.requireById(trimmedId, companyId);
    const handler = this.documentCreationRegistry.resolve(
      electronicDocument.electronicDocumentType,
    );

    return handler.create(trimmedId, companyId);
  }
}
