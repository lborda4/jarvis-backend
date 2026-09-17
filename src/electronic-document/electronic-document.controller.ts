import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocumentListQueryDto } from './dto/electronic-document-list-query.dto';
import { ElectronicDocumentListResponseDto } from './dto/electronic-document-list-response.dto';
import { ElectronicDocumentFilterOptionsDto } from './dto/electronic-document-filter-options.dto';
import { ElectronicDocumentCompanyOptionDto } from './dto/electronic-document-company-option.dto';
import { ElectronicDocumentType } from './enums/electronic-document-type.enum';
import {
  DeleteElectronicDocumentsBatchRequestDto,
  DeleteElectronicDocumentsBatchResponseDto,
} from './dto/delete-electronic-documents-batch.dto';
import {
  SaveElectronicDocumentDraftRequestDto,
  SaveElectronicDocumentDraftResponseDto,
} from './dto/save-electronic-document-draft.dto';

@ApiTags('electronic-documents')
@Controller('electronic-documents')
export class ElectronicDocumentController {
  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar historial de documentos electrónicos',
    description:
      'Consulta paginada del historial de la empresa activa del usuario autenticado.',
  })
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ElectronicDocumentListQueryDto,
  ): Promise<ElectronicDocumentListResponseDto> {
    return this.electronicDocumentService.listDocuments(
      query,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('filter-options')
  @ApiOperation({
    summary: 'Opciones de filtro para documentos electrónicos',
    description:
      'Devuelve valores disponibles para filtrar el historial de la empresa activa.',
  })
  getFilterOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('electronicDocumentType') electronicDocumentType?: ElectronicDocumentType,
  ): Promise<ElectronicDocumentFilterOptionsDto> {
    return this.electronicDocumentService.getFilterOptions(
      getAuthenticatedCompanyId(user),
      electronicDocumentType,
    );
  }

  @Get('companies')
  @ApiOperation({
    summary: 'Listar empresa activa del usuario autenticado',
  })
  listCompanies(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ElectronicDocumentCompanyOptionDto[]> {
    return this.electronicDocumentService.listCompanyOptions(
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('delete-batch')
  @ApiOperation({
    summary: 'Eliminar en lote documentos electrónicos locales',
    description:
      'Borra de la base de datos, en una sola operación, los documentos locales que aún no estén en estado lista (enviado). Los que sí lo estén se omiten y se reportan en skippedIds.',
  })
  deleteDocumentsBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: DeleteElectronicDocumentsBatchRequestDto,
  ): Promise<DeleteElectronicDocumentsBatchResponseDto> {
    return this.electronicDocumentService.deleteLocalDocuments(
      request.documentIds ?? [],
      getAuthenticatedCompanyId(user),
    );
  }

  @Put(':documentId/draft')
  @ApiOperation({
    summary: 'Guardar borrador de contabilización',
    description:
      'Persiste en electronic_documents.draft los ajustes del panel de detalle (ítems, cuenta, medio de pago, retenciones, plazo y observaciones) para que no se pierdan al recargar. El historial de SIIGO no se toca: ese se escribe solo cuando el envío se confirma.',
  })
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Body() request: SaveElectronicDocumentDraftRequestDto,
  ): Promise<SaveElectronicDocumentDraftResponseDto> {
    return this.electronicDocumentService.saveDraft(
      documentId,
      getAuthenticatedCompanyId(user),
      request,
    );
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar documento electrónico local',
    description:
      'Borra de la base de datos un Documento soporte o Factura de compra que aún no esté en estado lista (enviado).',
  })
  async deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    await this.electronicDocumentService.deleteLocalDocument(
      documentId,
      getAuthenticatedCompanyId(user),
    );
  }
}
