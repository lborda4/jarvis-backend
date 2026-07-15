import { Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import {
  CreateSiigoPurchaseRequestDto,
  CreateSiigoPurchaseResponseDto,
} from './dto/create-siigo-purchase.dto';
import {
  CreateSiigoSupportDocumentRequestDto,
  CreateSiigoSupportDocumentResponseDto,
} from './dto/create-siigo-support-document.dto';
import { CreateSiigoSupplierRequestDto } from './dto/create-siigo-supplier-request.dto';
import { CreateSiigoSupplierResponseDto } from './dto/create-siigo-supplier-response.dto';
import {
  SaveAccountMappingRequestDto,
  SaveAccountMappingResponseDto,
} from './dto/save-account-mapping.dto';
import {
  ValidateAccountMappingRequestDto,
  ValidateAccountMappingResponseDto,
} from './dto/validate-account-mapping.dto';
import {
  ValidateSiigoImportRequestDto,
  ValidateSiigoImportResponseDto,
} from './dto/validate-siigo-import.dto';
import { ResumeElectronicDocumentRequestDto } from '../../electronic-document/dto/resume-electronic-document.dto';
import {
  ResumeElectronicDocumentsBatchRequestDto,
  ResumeElectronicDocumentsBatchResponseDto,
} from '../../electronic-document/dto/resume-electronic-documents-batch.dto';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';
import { SiigoDocumentResumeService } from './siigo-document-resume.service';
import { SiigoPurchaseCreationService } from './siigo-purchase-creation.service';
import { SiigoSupportDocumentSendService } from './siigo-support-document-send.service';
import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { SiigoValidationService } from './siigo-validation.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoBalanceTrialImportService } from './siigo-balance-trial-import.service';
import {
  ImportBalanceTrialRequestDto,
  ImportBalanceTrialResponseDto,
} from './dto/import-balance-trial-response.dto';
import {
  ListSiigoAccountsQueryDto,
  SiigoAccountCatalogItemDto,
} from './dto/list-siigo-accounts.dto';
import {
  ListSiigoPaymentTypesQueryDto,
  SiigoPaymentTypeCatalogItemDto,
} from './dto/list-siigo-payment-types.dto';
import {
  ListSiigoTaxesQueryDto,
  SiigoTaxCatalogItemDto,
} from './dto/list-siigo-taxes.dto';
import {
  PrepareSiigoDocumentsRequestDto,
  PrepareSiigoDocumentsResponseDto,
} from './dto/prepare-siigo-documents.dto';
import {
  SaveSiigoCredentialsRequestDto,
  SaveSiigoCredentialsResponseDto,
} from './dto/save-siigo-credentials.dto';
import { SiigoPaymentTypesCatalogService } from './siigo-payment-types-catalog.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';

@ApiTags('integrations/siigo')
@Controller('integrations/siigo')
export class SiigoController {
  constructor(
    private readonly siigoValidationService: SiigoValidationService,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierCreationService: SiigoSupplierCreationService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoPurchaseCreationService: SiigoPurchaseCreationService,
    private readonly siigoSupportDocumentSendService: SiigoSupportDocumentSendService,
    private readonly siigoDocumentResumeService: SiigoDocumentResumeService,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoAccountsCatalogService: SiigoAccountsCatalogService,
    private readonly siigoPaymentTypesCatalogService: SiigoPaymentTypesCatalogService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoBalanceTrialImportService: SiigoBalanceTrialImportService,
  ) {}

  @Post('credentials')
  @ApiOperation({
    summary: 'Guardar credenciales SIIGO',
    description:
      'Persiste username, access_key y partner_id en integrations.credentials de la empresa activa. Autentica contra SIIGO para generar token y expires_at.',
  })
  saveCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveSiigoCredentialsRequestDto,
  ): Promise<SaveSiigoCredentialsResponseDto> {
    return this.siigoAuthService.saveCredentials(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'Catálogo de cuentas contables',
    description:
      'Consolida las cuentas configuradas en mapping_value de todos los terceros de la empresa activa.',
  })
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: ListSiigoAccountsQueryDto,
  ): Promise<SiigoAccountCatalogItemDto[]> {
    return this.siigoAccountsCatalogService.listAccounts(
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('payment-types')
  @ApiOperation({
    summary: 'Catálogo de medios de pago',
    description:
      'Consulta las formas de pago configuradas en SIIGO. Envíe documentType=FC para factura de compra o documentType=DS para documento soporte.',
  })
  listPaymentTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSiigoPaymentTypesQueryDto,
  ): Promise<SiigoPaymentTypeCatalogItemDto[]> {
    return this.siigoPaymentTypesCatalogService.listPaymentTypes(
      query,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('taxes')
  @ApiOperation({
    summary: 'Catálogo de impuestos SIIGO',
    description:
      'Consulta los impuestos configurados en SIIGO. Opcionalmente filtre por type (por ejemplo, IVA, ReteIVA, ReteICA, Retefuente).',
  })
  listTaxes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSiigoTaxesQueryDto,
  ): Promise<SiigoTaxCatalogItemDto[]> {
    return this.siigoTaxesCatalogService.listTaxes(
      query,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('import')
  validateImport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: ValidateSiigoImportRequestDto,
  ): Promise<ValidateSiigoImportResponseDto> {
    return this.siigoValidationService.validateImport(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('suppliers')
  createSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateSiigoSupplierRequestDto,
  ): Promise<CreateSiigoSupplierResponseDto> {
    return this.siigoSupplierCreationService.createSupplier(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('account-mappings/validate')
  validateAccountMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: ValidateAccountMappingRequestDto,
  ): Promise<ValidateAccountMappingResponseDto> {
    return this.siigoAccountMappingService.validateAccountMapping(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('account-mappings')
  saveAccountMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveAccountMappingRequestDto,
  ): Promise<SaveAccountMappingResponseDto> {
    return this.siigoAccountMappingService.saveAccountMapping(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('purchases')
  createPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateSiigoPurchaseRequestDto,
  ): Promise<CreateSiigoPurchaseResponseDto> {
    return this.siigoPurchaseCreationService.createPurchase(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('support-documents')
  @ApiOperation({
    summary: 'Crear Documento Soporte en SIIGO',
    description:
      'Recibe date, supplier, supplier_receipt_number, items y payments desde el front. El document.id se resuelve consultando SIIGO con type=DS.',
  })
  createSupportDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateSiigoSupportDocumentRequestDto,
  ): Promise<CreateSiigoSupportDocumentResponseDto> {
    return this.siigoSupportDocumentSendService.sendSupportDocument(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('balance-trial/import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Importar Balance de Prueba por Terceros',
    description:
      'Sin archivo: solicita el reporte a SIIGO, descarga el Excel y sincroniza proveedores/cuentas en supplier_configurations. Con archivo: procesa el Excel subido manualmente.',
  })
  importBalanceTrial(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() request: ImportBalanceTrialRequestDto,
  ): Promise<ImportBalanceTrialResponseDto> {
    return this.siigoBalanceTrialImportService.importBalanceTrial(
      file,
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('documents/prepare')
  @ApiOperation({
    summary: 'Preparar documentos en SIIGO',
    description:
      'Inicia en segundo plano la validación de proveedor, cuenta recomendada y autoApply para los documentos indicados.',
  })
  prepareDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: PrepareSiigoDocumentsRequestDto,
  ): PrepareSiigoDocumentsResponseDto {
    const documentIds = (request.documentIds ?? [])
      .map((documentId) => documentId?.trim())
      .filter(Boolean);
    const companyId = getAuthenticatedCompanyId(user);

    this.siigoDocumentPreparationService.prepareDocumentsInBackground(
      documentIds,
      companyId,
    );

    return {
      accepted: documentIds.length,
      message:
        'Preparación SIIGO iniciada en segundo plano. Consulte el estado en electronic-documents.',
    };
  }

  @Post('documents/resume')
  resumeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: ResumeElectronicDocumentRequestDto,
  ) {
    return this.siigoDocumentResumeService.resume(
      request.documentId,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('documents/resume-batch')
  @ApiOperation({
    summary: 'Reanudar documentos en lote',
    description:
      'Valida proveedor y cuenta para varios documentos reutilizando el token SIIGO y cacheando proveedores por NIT.',
  })
  resumeDocumentsBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: ResumeElectronicDocumentsBatchRequestDto,
  ): Promise<ResumeElectronicDocumentsBatchResponseDto> {
    return this.siigoDocumentResumeService.resumeBatch(
      request.documentIds ?? [],
      getAuthenticatedCompanyId(user),
      { prepareOnly: request.prepareOnly ?? true },
    );
  }
}
