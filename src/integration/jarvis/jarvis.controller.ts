import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import { JarvisCredentialsStatusResponseDto } from './dto/jarvis-credentials-status.dto';
import {
  CreateJarvisSupportDocumentRequestDto,
  CreateJarvisSupportDocumentResponseDto,
  CreateManualJarvisSupportDocumentRequestDto,
  CreateManualJarvisSupportDocumentResponseDto,
  JarvisCatalogsResponseDto,
} from './dto/create-jarvis-support-document.dto';
import {
  CreateJarvisInvoiceRequestDto,
  CreateJarvisInvoiceResponseDto,
} from './dto/create-jarvis-invoice.dto';
import {
  CreateJarvisTercerosBulkRequestDto,
  CreateJarvisTercerosBulkResponseDto,
  CreateJarvisTerceroRequestDto,
  CreateJarvisTerceroResponseDto,
  JarvisCatalogListResponseDto,
  JarvisTercerosListResponseDto,
  ListPendingJarvisSuppliersResponseDto,
  LookupJarvisTerceroNitRequestDto,
  LookupJarvisTerceroNitResponseDto,
  UpdateJarvisTerceroRequestDto,
  UpdateJarvisTerceroResponseDto,
} from './dto/jarvis-tercero.dto';
import {
  ListJarvisAvailableResolutionsResponseDto,
  ParseJarvisResolutionResponseDto,
  ParseJarvisResolutionUploadDto,
  SaveJarvisResolutionRequestDto,
  SaveJarvisResolutionResponseDto,
} from './dto/jarvis-resolution.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import {
  CreateJarvisTaxRequestDto,
  CreateJarvisTaxResponseDto,
  DeleteJarvisTaxResponseDto,
  JarvisTaxesListResponseDto,
  UpdateJarvisTaxRequestDto,
  UpdateJarvisTaxResponseDto,
} from './dto/jarvis-tax.dto';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { JarvisInvoiceSendService } from './jarvis-invoice-send.service';
import { JarvisResolutionParserService } from './jarvis-resolution-parser.service';
import { JarvisSetupService } from './jarvis-setup.service';
import { JarvisSupportDocumentSendService } from './jarvis-support-document-send.service';
import { JarvisTaxesService } from './jarvis-taxes.service';
import { JarvisTercerosService } from './jarvis-terceros.service';

@ApiTags('integrations/jarvis')
@Controller('integrations/jarvis')
export class JarvisController {
  constructor(
    private readonly jarvisSetupService: JarvisSetupService,
    private readonly jarvisTercerosService: JarvisTercerosService,
    private readonly jarvisSupportDocumentSendService: JarvisSupportDocumentSendService,
    private readonly jarvisInvoiceSendService: JarvisInvoiceSendService,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
    private readonly jarvisResolutionParserService: JarvisResolutionParserService,
    private readonly jarvisTaxesService: JarvisTaxesService,
  ) {}

  @Post('credentials')
  @ApiOperation({
    summary: 'Guardar configuración inicial Jarvis',
    description:
      'Persiste razón social, nombre comercial, tipo de régimen, régimen IVA, responsabilidad tributaria y actividad económica en integrations.credentials.',
  })
  saveCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveJarvisCredentialsRequestDto,
  ): Promise<SaveJarvisCredentialsResponseDto> {
    return this.jarvisSetupService.saveCredentials(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('credentials/status')
  @ApiOperation({
    summary: 'Estado de configuración Jarvis',
    description:
      'Indica si la empresa activa ya completó la configuración inicial de Jarvis.',
  })
  getCredentialsStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JarvisCredentialsStatusResponseDto> {
    return this.jarvisSetupService.getCredentialsStatus(
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('resolutions/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ParseJarvisResolutionUploadDto })
  @ApiOperation({
    summary: 'Extraer datos de una resolución DIAN',
    description:
      'Lee el PDF de autorización de numeración (factura electrónica o documento soporte) y autocompleta el formulario.',
  })
  async parseResolution(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ParseJarvisResolutionResponseDto> {
    return this.jarvisResolutionParserService.parse(file);
  }

  @Get('resolutions/available')
  @ApiOperation({
    summary: 'Resoluciones DIAN habilitadas',
    description:
      'Consulta en NextPyme las resoluciones vigentes de la empresa para elegir cuál usar en factura electrónica y en documento soporte.',
  })
  listAvailableResolutions(): Promise<ListJarvisAvailableResolutionsResponseDto> {
    return this.jarvisSetupService.listAvailableResolutions();
  }

  @Post('resolutions')
  @ApiOperation({
    summary: 'Guardar resolución DIAN de Jarvis',
    description:
      'Persiste la resolución de factura electrónica o documento soporte en integrations.credentials.',
  })
  saveResolution(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: SaveJarvisResolutionRequestDto,
  ): Promise<SaveJarvisResolutionResponseDto> {
    return this.jarvisSetupService.saveResolution(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('catalogs')
  @ApiOperation({
    summary: 'Catálogos NextPyme para documento soporte',
    description:
      'Devuelve impuestos, medios de pago y formas de pago desde las tablas maestras de NextPyme.',
  })
  listCatalogs(): Promise<JarvisCatalogsResponseDto> {
    return this.jarvisSupportDocumentSendService.listCatalogs();
  }

  @Get('terceros')
  @ApiOperation({
    summary: 'Listar terceros Jarvis',
    description:
      'Devuelve los terceros creados para la empresa activa con integración Jarvis.',
  })
  listTerceros(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ): Promise<JarvisTercerosListResponseDto> {
    return this.jarvisTercerosService.list(
      getAuthenticatedCompanyId(user),
      search,
    );
  }

  @Get('terceros/countries')
  @ApiOperation({
    summary: 'Listar países (tabla maestra de NextPyme)',
  })
  listTerceroCountries(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JarvisCatalogListResponseDto> {
    return this.jarvisTercerosService.listCountries(
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('terceros/municipalities')
  @ApiOperation({
    summary: 'Listar municipios (tabla maestra de NextPyme)',
  })
  listTerceroMunicipalities(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JarvisCatalogListResponseDto> {
    return this.jarvisTercerosService.listMunicipalities(
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('terceros/lookup-nit')
  @ApiOperation({
    summary: 'Consultar tercero por documento en NextPyme',
    description:
      'Resuelve el tipo de documento en el catálogo de NextPyme y consulta RUT/RUES para autocompletar el formulario.',
  })
  lookupTerceroNit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: LookupJarvisTerceroNitRequestDto,
  ): Promise<LookupJarvisTerceroNitResponseDto> {
    return this.jarvisTercerosService.lookupNit(
      getAuthenticatedCompanyId(user),
      request.document_type,
      request.identification_number,
    );
  }

  @Get('terceros/pending')
  @ApiOperation({
    summary: 'Listar proveedores pendientes de crear como tercero',
    description:
      'Un candidato por cada proveedor distinto (NIT + tipo de documento) que aparece en documentos con estado "Requiere proveedor", enriquecido con la consulta a NextPyme — para el modal de creación masiva de terceros.',
  })
  listPendingTerceros(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListPendingJarvisSuppliersResponseDto> {
    return this.jarvisTercerosService.listPendingSuppliers(
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('terceros/bulk')
  @ApiOperation({
    summary: 'Crear terceros Jarvis en lote',
    description:
      'Crea varios terceros de una sola vez (modal de creación masiva) y reanuda la preparación de los documentos pendientes de cada proveedor creado.',
  })
  createTercerosBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateJarvisTercerosBulkRequestDto,
  ): Promise<CreateJarvisTercerosBulkResponseDto> {
    return this.jarvisTercerosService.createBulk(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('terceros')
  @ApiOperation({
    summary: 'Crear tercero Jarvis',
    description:
      'Crea un tercero asociado a la integración Jarvis de la empresa activa.',
  })
  createTercero(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateJarvisTerceroRequestDto,
  ): Promise<CreateJarvisTerceroResponseDto> {
    return this.jarvisTercerosService.create(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Put('terceros/:id')
  @ApiOperation({
    summary: 'Editar tercero Jarvis',
    description:
      'Actualiza los datos de un tercero existente de la empresa activa. El tipo y número de documento no se modifican.',
  })
  updateTercero(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() request: UpdateJarvisTerceroRequestDto,
  ): Promise<UpdateJarvisTerceroResponseDto> {
    return this.jarvisTercerosService.update(
      id,
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('support-documents')
  @ApiOperation({
    summary: 'Enviar documento soporte a DIAN vía NextPyme',
    description:
      'Construye el payload UBL de documento soporte y lo emite con NextPyme supportDocument.create.',
  })
  createSupportDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateJarvisSupportDocumentRequestDto,
  ): Promise<CreateJarvisSupportDocumentResponseDto> {
    return this.jarvisSupportDocumentSendService.sendSupportDocument(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('support-documents/manual')
  @ApiOperation({
    summary: 'Crear documento soporte individual',
    description:
      'Crea un Documento Soporte desde el formulario uno a uno. Con send=true también lo emite en NextPyme/DIAN.',
  })
  createManualSupportDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateManualJarvisSupportDocumentRequestDto,
  ): Promise<CreateManualJarvisSupportDocumentResponseDto> {
    return this.jarvisSupportDocumentSendService.createManualSupportDocument(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('invoices')
  @ApiOperation({
    summary: 'Crear y enviar factura de venta',
    description:
      'Construye el payload UBL de factura electrónica de venta y la emite de una vez con NextPyme invoice.create.',
  })
  createInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateJarvisInvoiceRequestDto,
  ): Promise<CreateJarvisInvoiceResponseDto> {
    return this.jarvisInvoiceSendService.createAndSendInvoice(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('documents/prepare')
  @ApiOperation({
    summary: 'Preparar documentos soporte Jarvis en lote',
    description:
      'Valida existencia de terceros y deja los documentos listos para envío (sin cuenta contable).',
  })
  prepareDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { documentIds: string[] },
  ): { accepted: boolean } {
    this.jarvisDocumentPreparationService.prepareDocumentsInBackground(
      body.documentIds ?? [],
      getAuthenticatedCompanyId(user),
    );

    return { accepted: true };
  }

  @Post('documents/resume')
  @ApiOperation({
    summary: 'Reanudar preparación de un documento soporte Jarvis',
  })
  resumeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { documentId: string },
  ) {
    return this.jarvisDocumentPreparationService.resume(
      body.documentId,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('taxes')
  @ApiOperation({
    summary: 'Listar impuestos y retenciones Jarvis',
    description:
      'Devuelve el catálogo de impuestos/retenciones de la empresa activa. `category` filtra IMPUESTO/RETENCION (las dos pestañas de la pantalla comparten la misma tabla).',
  })
  listTaxes(
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('is_active') isActive?: string,
  ): Promise<JarvisTaxesListResponseDto> {
    return this.jarvisTaxesService.list(
      getAuthenticatedCompanyId(user),
      category,
      search,
      isActive === undefined ? undefined : isActive === 'true',
    );
  }

  @Post('taxes')
  @ApiOperation({
    summary: 'Crear impuesto o retención Jarvis',
  })
  createTax(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: CreateJarvisTaxRequestDto,
  ): Promise<CreateJarvisTaxResponseDto> {
    return this.jarvisTaxesService.create(
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Patch('taxes/:id')
  @ApiOperation({
    summary: 'Actualizar impuesto o retención Jarvis',
  })
  updateTax(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() request: UpdateJarvisTaxRequestDto,
  ): Promise<UpdateJarvisTaxResponseDto> {
    return this.jarvisTaxesService.update(
      id,
      request,
      getAuthenticatedCompanyId(user),
    );
  }

  @Delete('taxes/:id')
  @ApiOperation({
    summary: 'Eliminar impuesto o retención Jarvis',
  })
  deleteTax(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeleteJarvisTaxResponseDto> {
    return this.jarvisTaxesService.remove(id, getAuthenticatedCompanyId(user));
  }
}
