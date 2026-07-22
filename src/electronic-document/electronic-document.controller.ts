import { Controller, Get, Query } from '@nestjs/common';
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
}
