import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

export class MissingFileException extends BadRequestException {
  constructor() {
    super('No se recibió ningún archivo. Envíe el archivo en el campo "file".');
  }
}

export class InvalidXmlFormatException extends BadRequestException {
  constructor(detail: string) {
    super(`Formato de XML inválido: ${detail}`);
  }
}

export class XmlParserException extends InternalServerErrorException {
  constructor(detail: string) {
    super(`Error al procesar el XML: ${detail}`);
  }
}

export class InvalidExcelFormatException extends BadRequestException {
  constructor(detail: string) {
    super(`Formato de Excel inválido: ${detail}`);
  }
}
