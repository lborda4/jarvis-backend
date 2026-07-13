import { ElectronicDocumentProcessingStatus } from '../enums/electronic-document-processing-status.enum';
import { SuggestedAccount } from '../../integration/helpers/supplier-accounts-catalog.helper';
import {
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../../integration/interfaces/supplier-mapping-value.interface';
import { ElectronicDocumentListItemItemDto } from './electronic-document-list-item-item.dto';

export class ElectronicDocumentListItemDto {
  id: string;
  companyId: string;
  companyName: string;
  cufe: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  supplierName: string | null;
  supplierNit: string | null;
  total: number;
  status: string;
  electronicDocumentType: string | null;
  supplierExistsInSiigo: boolean | null;
  suggestedAccount: SuggestedAccount | null;
  suggestedPaymentMethod: SupplierPaymentMethodPreference | null;
  suggestedRetentions: SupplierRetentionPreference[];
  processingStatus: ElectronicDocumentProcessingStatus;
  items?: ElectronicDocumentListItemItemDto[];
  createdAt: string;
  updatedAt: string;
}
