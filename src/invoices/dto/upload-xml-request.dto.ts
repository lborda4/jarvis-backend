import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';

export class UploadXmlRequestDto {
  provider?: string;
  electronicDocumentType: ElectronicDocumentType;
}
