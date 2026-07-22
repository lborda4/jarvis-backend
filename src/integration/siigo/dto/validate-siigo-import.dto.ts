import { SiigoImportValidationStatus } from '../enums/siigo-import-validation-status.enum';

export class ValidateSiigoImportRequestDto {
  documentId: string;
}

export class ValidateSiigoImportResponseDto {
  status: SiigoImportValidationStatus;
  supplierConfigurationId: string | null;
  supplierDocument: string;
  supplierName: string | null;
  accountCode: string | null;
  message?: string;
}
