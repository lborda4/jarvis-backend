import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocumentListQueryDto } from './dto/electronic-document-list-query.dto';
import { ElectronicDocumentListResponseDto } from './dto/electronic-document-list-response.dto';
import { ElectronicDocumentCompanyOptionDto } from './dto/electronic-document-company-option.dto';

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
