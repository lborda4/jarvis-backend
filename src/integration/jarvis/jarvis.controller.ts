import {
  Body,
  Controller,
  Get,
  Post,
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
  CreateJarvisTerceroRequestDto,
  CreateJarvisTerceroResponseDto,
  JarvisTercerosListResponseDto,
  LookupJarvisTerceroNitRequestDto,
  LookupJarvisTerceroNitResponseDto,
} from './dto/jarvis-tercero.dto';
import {
  ParseJarvisResolutionResponseDto,
  ParseJarvisResolutionUploadDto,
  SaveJarvisResolutionRequestDto,
  SaveJarvisResolutionResponseDto,
} from './dto/jarvis-resolution.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { JarvisResolutionParserService } from './jarvis-resolution-parser.service';
import { JarvisSetupService } from './jarvis-setup.service';
import { JarvisSupportDocumentSendService } from './jarvis-support-document-send.service';
import { JarvisTercerosService } from './jarvis-terceros.service';

@ApiTags('integrations/jarvis')
@Controller('integrations/jarvis')
export class JarvisController {
  constructor(
    private readonly jarvisSetupService: JarvisSetupService,
    private readonly jarvisTercerosService: JarvisTercerosService,
    private readonly jarvisSupportDocumentSendService: JarvisSupportDocumentSendService,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
    private readonly jarvisResolutionParserService: JarvisResolutionParserService,
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
}
