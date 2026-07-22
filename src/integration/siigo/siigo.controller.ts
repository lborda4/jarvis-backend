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
import { SiigoPurchaseSendService } from './siigo-purchase-send.service';
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
import { SiigoCostCenterCatalogItemDto } from './dto/list-siigo-cost-centers.dto';
import {
  PrepareSiigoDocumentsRequestDto,
  PrepareSiigoDocumentsResponseDto,
} from './dto/prepare-siigo-documents.dto';
import {
  SaveSiigoCredentialsRequestDto,
  SaveSiigoCredentialsResponseDto,
} from './dto/save-siigo-credentials.dto';
import { SiigoCredentialsStatusResponseDto } from './dto/siigo-credentials-status.dto';
import {
  CreateSiigoPurchaseSendRequestDto,
  CreateSiigoPurchaseSendResponseDto,
} from './dto/create-siigo-purchase-send.dto';
import { SiigoPaymentTypesCatalogService } from './siigo-payment-types-catalog.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoCatalogSyncService } from './siigo-catalog-sync.service';

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
    private readonly siigoPurchaseSendService: SiigoPurchaseSendService,
    private readonly siigoDocumentResumeService: SiigoDocumentResumeService,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoAccountsCatalogService: SiigoAccountsCatalogService,
    private readonly siigoCatalogSyncService: SiigoCatalogSyncService,
    private readonly siigoPaymentTypesCatalogService: SiigoPaymentTypesCatalogService,
    private readonly siigoCostCentersCatalogService: SiigoCostCentersCatalogService,
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

  @Get('credentials/status')
  @ApiOperation({
    summary: 'Estado de credenciales SIIGO',
    description:
      'Indica si la empresa activa del JWT ya tiene credenciales SIIGO guardadas.',
  })
  getCredentialsStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SiigoCredentialsStatusResponseDto> {
    return this.siigoAuthService.getCredentialsStatus(
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'Catálogo de cuentas contables',
    description:
      'Consulta las cuentas contables transaccionales almacenadas en la base de datos para la empresa activa.',
  })
  listAccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: ListSiigoAccountsQueryDto,
  ): Promise<SiigoAccountCatalogItemDto[]> {
    return this.siigoAccountsCatalogService.listAccounts(
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('catalog/sync')
  @ApiOperation({
    summary: 'Sincronizar catálogos SIIGO',
    description:
      'Actualiza cuentas contables en base de datos y refresca medios de pago, impuestos y centros de costo en caché local.',
  })
  syncCatalogs(@CurrentUser() user: AuthenticatedUser): Promise<{ synced: true }> {
    return this.siigoCatalogSyncService
      .syncCatalogs(getAuthenticatedCompanyId(user))
      .then(() => ({ synced: true }));
  }

  @Get('payment-types')
  @ApiOperation({
    summary: 'Catálogo de medios de pago',
    description:
      'Consulta las formas de pago sincronizadas en caché local. Ejecute POST /catalog/sync al ingresar para refrescarlas.',
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
      'Consulta los impuestos sincronizados en caché local. Ejecute POST /catalog/sync al ingresar para refrescarlos.',
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

  @Get('cost-centers')
  @ApiOperation({
    summary: 'Catálogo de centros de costo SIIGO',
    description:
      'Consulta los centros de costo configurados en SIIGO y los sirve desde caché local.',
  })
  listCostCenters(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SiigoCostCenterCatalogItemDto[]> {
    return this.siigoCostCentersCatalogService.listCostCenters(
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
  @ApiOperation({
    summary: 'Crear factura de compra en SIIGO',
    description:
      'Recibe documentId y delega la creación al handler de factura de compra. Para envío con cuenta, pago y retenciones use POST /integrations/siigo/purchases/send.',
  })
  createPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateSiigoPurchaseRequestDto,
  ): Promise<CreateSiigoPurchaseResponseDto> {
    return this.siigoPurchaseCreationService.createPurchase(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('purchases/send')
  @ApiOperation({
    summary: 'Enviar factura de compra a SIIGO',
    description:
      'Recibe date, supplier, provider_invoice, items, payments y retenciones desde el front. El CUFE se envía en observations.',
  })
  sendPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateSiigoPurchaseSendRequestDto,
  ): Promise<CreateSiigoPurchaseSendResponseDto> {
    return this.siigoPurchaseSendService.sendPurchase(
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
    summary: 'Importar Balance de Prueba general',
    description:
      'Sin archivo: solicita el reporte a SIIGO (últimos 3 años), descarga el Excel y sincroniza cuentas contables en siigo_accounts. Con archivo: procesa el Excel subido manualmente.',
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
      'Inicia en segundo plano la validación de proveedor y cuenta recomendada para los documentos indicados.',
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
