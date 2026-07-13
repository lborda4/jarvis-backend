import { BadRequestException, Injectable } from '@nestjs/common';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { SiigoDocumentCreationHandler } from './interfaces/siigo-document-creation.handler';

@Injectable()
export class SiigoDocumentCreationRegistry {
  private readonly handlersByType = new Map<
    ElectronicDocumentType,
    SiigoDocumentCreationHandler
  >();

  constructor(handlers: SiigoDocumentCreationHandler[]) {
    for (const handler of handlers) {
      this.handlersByType.set(handler.documentType, handler);
    }
  }

  resolve(
    documentType: ElectronicDocumentType | null | undefined,
  ): SiigoDocumentCreationHandler {
    if (!documentType) {
      throw new BadRequestException(
        'El documento no tiene un tipo electrónico definido.',
      );
    }

    const handler = this.handlersByType.get(documentType);

    if (!handler) {
      throw new BadRequestException(
        `No existe un creador SIIGO configurado para el tipo ${documentType}.`,
      );
    }

    return handler;
  }
}
