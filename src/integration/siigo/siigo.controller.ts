import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
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
import { DeleteSiigoSupportDocumentResponseDto } from './dto/delete-siigo-support-document.dto';
import { DeleteSiigoPurchaseResponseDto } from './dto/delete-siigo-purchase.dto';
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
  ListAccountMappingRulesResponseDto,
  UpdateAccountMappingRuleRequestDto,
  UpdateAccountMappingRuleResponseDto,
} from './dto/account-mapping-rules.dto';
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
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoProductCatalogItemDto } from './dto/list-siigo-products.dto';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoCatalogSyncService } from './siigo-catalog-sync.service';
import { SiigoDocumentTypesService } from './siigo-document-types.service';
import {
  ListSiigoDocumentTypesQueryDto,
  SiigoDocumentTypeCatalogItemDto,
} from './dto/list-siigo-document-types.dto';
import {
  SaveSiigoDocumentTypesRequestDto,
  SaveSiigoDocumentTypesResponseDto,
} from './dto/save-siigo-document-types.dto';
import { SuggestPurchaseItemClassificationResponseDto } from './dto/suggest-purchase-item-classification.dto';
import { SiigoAiAccountSuggestionService } from './siigo-ai-account-suggestion.service';
import {
  PurchaseHistorySyncStatusResponseDto,
  StartPurchaseHistorySyncResponseDto,
} from './dto/purchase-history-sync.dto';
import { SiigoPurchaseHistorySyncService } from './siigo-purchase-history-sync.service';
import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';

@ApiTags('integrations/siigo')
@Controller('integrations/siigo')
export class SiigoController {
  private readonly logger = new Logger(SiigoController.name);

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
    private readonly siigoPurchaseAiClassificationService: SiigoPurchaseAiClassificationService,
    private readonly siigoAccountsCatalogService: SiigoAccountsCatalogService,
    private readonly siigoCatalogSyncService: SiigoCatalogSyncService,
    private readonly siigoPaymentTypesCatalogService: SiigoPaymentTypesCatalogService,
    private readonly siigoCostCentersCatalogService: SiigoCostCentersCatalogService,
    private readonly siigoProductsCatalogService: SiigoProductsCatalogService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoBalanceTrialImportService: SiigoBalanceTrialImportService,
    private readonly siigoDocumentTypesService: SiigoDocumentTypesService,
    private readonly siigoAiAccountSuggestionService: SiigoAiAccountSuggestionService,
    private readonly siigoPurchaseHistorySyncService: SiigoPurchaseHistorySyncService,
  ) {}

  @Post('credentials')
  @ApiOperation({
    summary: 'Guardar credenciales SIIGO',
    description:
      'Persiste username, access_key y partner_id en integrations.credentials de la empresa activa. Autentica contra SIIGO para generar token y expires_at.',
  })
  async saveCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveSiigoCredentialsRequestDto,
  ): Promise<SaveSiigoCredentialsResponseDto> {
    const companyId = getAuthenticatedCompanyId(user);
    const response = await this.siigoAuthService.saveCredentials(
      request,
      companyId,
    );

    // Apenas las credenciales quedan guardadas y validadas, adelanta en
    // segundo plano la carga de impuestos, medios de pago y comprobantes de
    // cargue (Documento Soporte/Factura de compra) — así cuando el usuario
    // avanza a los pasos siguientes del asistente, esos catálogos ya están
    // tibios en caché en vez de esperar la consulta a SIIGO en ese momento.
    // Fire-and-forget a propósito: nunca debe demorar ni romper la
    // respuesta de este endpoint, y si falla acá el catálogo igual se
    // resuelve solo (bajo demanda) la próxima vez que alguien lo pida —
    // ver SiigoConfigurationCacheService.ensureCompanyCache.
    void this.siigoCatalogSyncService.syncCatalogs(companyId).catch((error) => {
      this.logger.warn(
        `[companyId=${companyId}] No se pudo adelantar la carga de catálogos SIIGO tras guardar credenciales — se resolverá bajo demanda más adelante.`,
        error instanceof Error ? error.message : String(error),
      );
    });

    return response;
  }

  @Get('credentials/status')
  @ApiOperation({
    summary: 'Estado de credenciales SIIGO',
    description:
      'Indica si la empresa activa del JWT ya tiene credenciales SIIGO, cuentas contables sincronizadas y comprobantes de cargue configurados.',
  })
  getCredentialsStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SiigoCredentialsStatusResponseDto> {
    return this.siigoAuthService.getCredentialsStatus(
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('document-types')
  @ApiOperation({
    summary: 'Listar comprobantes SIIGO (document types)',
    description:
      'Consulta GET /v1/document-types de SIIGO filtrado por type=DS (Documento soporte) o type=FC (Factura de compra).',
  })
  listDocumentTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSiigoDocumentTypesQueryDto,
  ): Promise<SiigoDocumentTypeCatalogItemDto[]> {
    return this.siigoDocumentTypesService.listDocumentTypesForCompany(
      getAuthenticatedCompanyId(user),
      query.type,
    );
  }

  @Put('document-types/selection')
  @ApiOperation({
    summary: 'Guardar comprobantes de cargue',
    description:
      'Persiste los ids de comprobante DS/FC seleccionados en integrations.credentials.document_types.',
  })
  saveDocumentTypeSelection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveSiigoDocumentTypesRequestDto,
  ): Promise<SaveSiigoDocumentTypesResponseDto> {
    return this.siigoDocumentTypesService.saveDocumentTypeSelection(
      getAuthenticatedCompanyId(user),
      request,
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
  syncCatalogs(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ synced: true }> {
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

  @Get('products')
  @ApiOperation({
    summary: 'Catálogo de productos SIIGO',
    description:
      'Consulta GET /v1/products de SIIGO (paginado) y lo sirve desde caché local.',
  })
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SiigoProductCatalogItemDto[]> {
    return this.siigoProductsCatalogService.listProducts(
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

  @Get('account-mappings/rules')
  @ApiOperation({
    summary: 'Reglas de mapeo de cuenta PUC por proveedor + ítem',
  })
  listAccountMappingRules(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListAccountMappingRulesResponseDto> {
    return this.siigoAccountMappingService.listAccountMappingRules(
      getAuthenticatedCompanyId(user),
    );
  }

  @Patch('account-mappings/rules/item')
  @ApiOperation({
    summary: 'Edita la cuenta PUC de una regla puntual (proveedor + ítem)',
  })
  updateAccountMappingRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: UpdateAccountMappingRuleRequestDto,
  ): Promise<UpdateAccountMappingRuleResponseDto> {
    return this.siigoAccountMappingService.updateAccountMappingRule(
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

  @Delete('purchases/:documentId')
  @ApiOperation({
    summary: 'Eliminar factura de compra en SIIGO',
    description:
      'Elimina en SIIGO la factura de compra asociada al electronic-document local usando el siigoPurchaseId guardado.',
  })
  deletePurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ): Promise<DeleteSiigoPurchaseResponseDto> {
    return this.siigoPurchaseSendService.deletePurchase(
      documentId,
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

  @Delete('support-documents/:documentId')
  @ApiOperation({
    summary: 'Eliminar Documento Soporte en SIIGO',
    description:
      'Elimina en SIIGO el Documento Soporte asociado al electronic-document local usando el siigoPurchaseId guardado.',
  })
  deleteSupportDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ): Promise<DeleteSiigoSupportDocumentResponseDto> {
    return this.siigoSupportDocumentSendService.deleteSupportDocument(
      documentId,
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
    this.siigoPurchaseAiClassificationService.classifyDocumentsInBackground(
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

  @Post('documents/:documentId/ai-suggestion')
  @ApiOperation({
    summary: 'Sugerir cuenta contable e IVA con IA',
    description:
      'Usa IA (OpenAI) para sugerir, a partir de la descripción de los ítems, una cuenta contable y un impuesto IVA del catálogo SIIGO de la empresa. Solo sugiere valores que existan literalmente en el catálogo; nunca inventa códigos.',
  })
  suggestAccountWithAi(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ): Promise<SuggestPurchaseItemClassificationResponseDto> {
    return this.siigoAiAccountSuggestionService.suggestForDocument(
      documentId,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('purchases-history/sync')
  @ApiOperation({
    summary: 'Sincronizar historial de facturas de compra',
    description:
      'Pagina GET /v1/purchases de SIIGO, guarda en historial_facturas las de los últimos 2 años y recalcula la variabilidad por proveedor. Corre en segundo plano; consultar progreso en GET purchases-history/sync-status.',
  })
  startPurchaseHistorySync(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StartPurchaseHistorySyncResponseDto> {
    return this.siigoPurchaseHistorySyncService.startSync(
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('purchases-history/sync-status')
  @ApiOperation({
    summary: 'Estado del último sync de historial de facturas de compra',
  })
  async getPurchaseHistorySyncStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseHistorySyncStatusResponseDto> {
    const job = await this.siigoPurchaseHistorySyncService.getLatestStatus(
      getAuthenticatedCompanyId(user),
    );

    if (!job) {
      return {
        status: null,
        syncedCount: 0,
        totalCount: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      };
    }

    return {
      status: job.status,
      syncedCount: job.syncedCount,
      totalCount: job.totalCount,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
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
