import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
import { ExtractInvoicesResponseDto } from './dto/extract-invoices-response.dto';
import {
  ExtractSupportDocumentsResponseDto,
  ImportSupportDocumentsRequestDto,
  ImportSupportDocumentsResponseDto,
} from './dto/import-support-documents.dto';
import { ParseXmlResponseDto } from './dto/parse-xml-response.dto';
import { UploadXmlRequestDto } from './dto/upload-xml-request.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  extractInvoices(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ExtractInvoicesResponseDto> {
    return this.invoicesService.extractInvoicesFromExcel(file);
  }

  @Get('support-documents/template')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  downloadSupportDocumentTemplate(): StreamableFile {
    const { buffer, filename } =
      this.invoicesService.getSupportDocumentTemplate();

    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('support-documents/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewSupportDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ImportSupportDocumentsRequestDto,
  ): Promise<ExtractSupportDocumentsResponseDto> {
    return this.invoicesService.previewSupportDocumentsFromExcel(
      file,
      getAuthenticatedCompanyId(user),
      body,
    );
  }

  @Post('support-documents/import')
  @UseInterceptors(FileInterceptor('file'))
  importSupportDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ImportSupportDocumentsRequestDto,
  ): Promise<ImportSupportDocumentsResponseDto> {
    return this.invoicesService.importSupportDocumentsFromExcel(
      file,
      getAuthenticatedCompanyId(user),
      body,
    );
  }

  @Post('xml')
  @UseInterceptors(FileInterceptor('file'))
  extractInvoicesFromXml(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadXmlRequestDto,
  ): Promise<ParseXmlResponseDto> {
    return this.invoicesService.extractInvoicesFromXml(
      file,
      body,
      getAuthenticatedCompanyId(user),
    );
  }
}
