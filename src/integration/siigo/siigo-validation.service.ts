import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentProcessingStatus } from '../../electronic-document/enums/electronic-document-processing-status.enum';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import {
  ValidateSiigoImportRequestDto,
  ValidateSiigoImportResponseDto,
} from './dto/validate-siigo-import.dto';
import { SiigoImportValidationStatus } from './enums/siigo-import-validation-status.enum';
import {
  isSiigoRateLimitError,
  isSiigoUnauthorizedError,
  sleep,
} from './helpers/siigo-auth.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { buildSiigoImportResponse } from './helpers/siigo-import-response.helper';
import { getSiigoSupplierName } from './helpers/siigo-supplier.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoCustomer } from './interfaces/siigo-api.interface';

@Injectable()
export class SiigoValidationService {
  private readonly logger = new Logger(SiigoValidationService.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierService: SiigoSupplierService,
    private readonly electronicDocumentService: ElectronicDocumentService,
  ) {}

  async validateImport(
    request: ValidateSiigoImportRequestDto,
    companyId: string,
  ): Promise<ValidateSiigoImportResponseDto> {
    const documentId = request?.documentId?.trim();

    console.log('[SIIGO import] ===== INICIO =====');
    console.log('[SIIGO import] documentId', documentId);

    try {
      const electronicDocument =
        await this.electronicDocumentService.requireById(documentId, companyId);
      const supplier = resolveSupplierDocumentFromPayload(
        electronicDocument.payload,
      );

      if (!supplier.normalizedDocumentNumber) {
        throw new BadRequestException(
          'El documento electrónico no contiene un número de proveedor válido en el payload.',
        );
      }

      const branchOffice = 0;

      console.log('[SIIGO import] proveedor a consultar en SIIGO', {
        documentId,
        documentType: supplier.documentType,
        documentNumber: supplier.documentNumber,
        normalizedDocumentNumber: supplier.normalizedDocumentNumber,
        branchOffice,
      });

      const siigoSupplier = await this.findSupplierInSiigo(
        documentId,
        supplier.normalizedDocumentNumber,
        branchOffice,
        companyId,
      );

      if (!siigoSupplier) {
        console.log('[SIIGO import] resultado: NO existe en SIIGO', {
          documentId,
          supplierDocument: supplier.normalizedDocumentNumber,
        });

        await this.electronicDocumentService.updateStatus(
          documentId,
          ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
          companyId,
        );

        return buildSiigoImportResponse({
          status: SiigoImportValidationStatus.THIRD_PARTY_REQUIRED,
          supplierDocument: supplier.normalizedDocumentNumber,
          supplierName: electronicDocument.payload.supplier.name || null,
        });
      }

      const supplierName = getSiigoSupplierName(siigoSupplier);

      await this.electronicDocumentService.updateStatus(
        documentId,
        ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        companyId,
      );
      await this.electronicDocumentService.updateProcessingMetadata(
        documentId,
        {
          supplierExistsInSiigo: true,
          processingStatus: ElectronicDocumentProcessingStatus.ACCOUNT_REQUIRED,
        },
        companyId,
      );

      console.log('[SIIGO import] resultado: existe en SIIGO', {
        documentId,
        supplierDocument: supplier.normalizedDocumentNumber,
        supplierName,
        siigoCustomerId: siigoSupplier.id,
      });
      console.log('[SIIGO import] ===== FIN OK =====');

      return buildSiigoImportResponse({
        status: SiigoImportValidationStatus.ACCOUNT_REQUIRED,
        supplierDocument: supplier.normalizedDocumentNumber,
        supplierName,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        console.error('[SIIGO import] error de validación (400)', {
          documentId,
          message: error.message,
        });
        throw error;
      }

      console.error('[SIIGO import] error en flujo import', {
        documentId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al validar proveedor en SIIGO',
      );
    }
  }

  private async findSupplierInSiigo(
    documentId: string,
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
  ): Promise<SiigoCustomer | null> {
    console.log('[SIIGO import] obteniendo token SIIGO...', { documentId });

    const authContext = await this.siigoAuthService.getValidAuthContext(companyId);

    console.log('[SIIGO import] token SIIGO OK', {
      documentId,
      hasPartnerId: Boolean(authContext.partnerId),
      tokenPreview: authContext.accessToken.slice(0, 20) + '...',
    });

    return this.querySupplierWithRetries(
      documentId,
      authContext,
      supplierDocument,
      branchOffice,
      companyId,
    );
  }

  private async querySupplierWithRetries(
    documentId: string,
    authContext: { accessToken: string; partnerId?: string },
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
    attempt = 0,
  ): Promise<SiigoCustomer | null> {
    console.log('[SIIGO import] ANTES consulta proveedor SIIGO', {
      documentId,
      supplierDocument,
      branchOffice,
      attempt,
    });

    try {
      const result = await this.siigoSupplierService.findSupplierByNit(
        authContext.accessToken,
        supplierDocument,
        branchOffice,
        authContext.partnerId,
      );

      console.log('[SIIGO import] DESPUÉS consulta proveedor SIIGO', {
        documentId,
        supplierDocument,
        found: Boolean(result),
        siigoCustomerId: result?.id,
      });

      return result;
    } catch (error) {
      console.error('[SIIGO import] error en consulta proveedor SIIGO', {
        documentId,
        supplierDocument,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });

      this.logger.error(
        `[documentId=${documentId}] Error al consultar tercero en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (isSiigoUnauthorizedError(error) && attempt < 1) {
        console.log('[SIIGO import] reintentando por 401 - refrescando token', {
          documentId,
        });

        const refreshedContext =
          await this.siigoAuthService.forceRefreshAuthContext(companyId);

        console.log('[SIIGO import] token refrescado OK', { documentId });

        return this.querySupplierWithRetries(
          documentId,
          refreshedContext,
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
        );
      }

      if (isSiigoRateLimitError(error) && attempt < 2) {
        console.log('[SIIGO import] reintentando por 429', {
          documentId,
          attempt,
        });
        await sleep(1500);

        return this.querySupplierWithRetries(
          documentId,
          authContext,
          supplierDocument,
          branchOffice,
          companyId,
          attempt + 1,
        );
      }

      handleSiigoApiError(this.logger, error, 'consultar tercero');
    }
  }
}
