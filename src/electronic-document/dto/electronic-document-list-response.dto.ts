import { ElectronicDocumentListItemDto } from './electronic-document-list-item.dto';

export class ElectronicDocumentListResponseDto {
  items: ElectronicDocumentListItemDto[];
  total: number;
  page: number;
  limit: number;
}
