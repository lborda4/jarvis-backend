import {
  Body,
  Controller,
  Get,
  Header,
  Param,
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
import {
  PurchaseInvoiceImportStatusResponseDto,
  StartPurchaseInvoiceImportResponseDto,
} from './dto/purchase-invoice-import-job.dto';
import { PurchaseInvoiceValidationReportDto } from './dto/purchase-invoice-import-validation.dto';
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

  @Post('purchase-invoices/validate')
  @UseInterceptors(FileInterceptor('file'))
  validatePurchaseInvoices(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PurchaseInvoiceValidationReportDto> {
    return this.invoicesService.validatePurchaseInvoicesExcel(file);
  }

  @Post('purchase-invoices/import')
  @UseInterceptors(FileInterceptor('file'))
  importPurchaseInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<StartPurchaseInvoiceImportResponseDto> {
    return this.invoicesService.importPurchaseInvoicesFromExcel(
      file,
      getAuthenticatedCompanyId(user),
    );
  }

  @Get('purchase-invoices/import-jobs/:jobId/status')
  getPurchaseInvoiceImportJobStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    return this.invoicesService.getPurchaseInvoiceImportJobStatus(
      jobId,
      getAuthenticatedCompanyId(user),
    );
  }

  @Post('purchase-invoices/import-jobs/:jobId/retry-failed')
  retryFailedPurchaseInvoiceImportRows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    return this.invoicesService.retryFailedPurchaseInvoiceImportRows(
      jobId,
      getAuthenticatedCompanyId(user),
    );
  }

  /** @deprecated usar GET purchase-invoices/import-jobs/:jobId/status con el jobId devuelto por el POST de import. Se deja por compatibilidad. */
  @Get('purchase-invoices/import-status')
  getLatestPurchaseInvoiceImportStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    return this.invoicesService.getLatestPurchaseInvoiceImportStatus(
      getAuthenticatedCompanyId(user),
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
