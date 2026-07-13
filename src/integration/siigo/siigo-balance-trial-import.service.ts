import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { addAccountToSupplierMapping } from '../helpers/supplier-mapping-value.helper';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  BALANCE_TRIAL_MAX_SUPPLIERS,
  BALANCE_TRIAL_SAVE_BATCH_SIZE,
  SIIGO_DEFAULT_ITEM_TYPE,
} from './constants/supplier-configuration.constants';
import {
  ImportBalanceTrialRequestDto,
  ImportBalanceTrialResponseDto,
} from './dto/import-balance-trial-response.dto';
import {
  BalanceTrialExcelRow,
  limitBalanceTrialRows,
  parseBalanceTrialExcel,
} from './helpers/balance-trial-excel.helper';
import { buildBalanceTrialReportRequest } from './helpers/balance-trial-report-request.helper';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
  resolveSiigoCompany,
} from './helpers/siigo-context.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { SiigoAuthService } from './siigo-auth.service';

@Injectable()
export class SiigoBalanceTrialImportService {
  private readonly logger = new Logger(SiigoBalanceTrialImportService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly companiesRepository: CompaniesRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async importBalanceTrial(
    file: Express.Multer.File | undefined,
    request: ImportBalanceTrialRequestDto | undefined,
    companyId: string,
  ): Promise<ImportBalanceTrialResponseDto> {
    if (file) {
      return this.importBalanceTrialFromBuffer(
        file.buffer,
        companyId,
        file.originalname ?? 'archivo.xlsx',
      );
    }

    return this.importBalanceTrialFromSiigo(companyId, request);
  }

  async importBalanceTrialFromSiigo(
    companyId: string,
    request?: ImportBalanceTrialRequestDto,
  ): Promise<ImportBalanceTrialResponseDto> {
    const company = await resolveSiigoCompany(
      this.companiesRepository,
      companyId,
    );
    const reportRequest = buildBalanceTrialReportRequest(request);

    this.logger.log(
      `[companyId=${company.id}] Solicitando Balance de Prueba por Terceros a SIIGO`,
      reportRequest,
    );

    try {
      const report = await executeSiigoRequestWithRetries(
        this.siigoAuthService,
        company.id,
        this.logger,
        'generar balance de prueba por tercero',
        (accessToken, partnerId) =>
          this.siigoHttpClient.createTestBalanceByThirdParty(
            accessToken,
            reportRequest,
            partnerId,
          ),
      );

      if (!report.file_url?.trim()) {
        throw new Error(
          'SIIGO no devolvió una URL válida para descargar el Balance de Prueba por Terceros.',
        );
      }

      this.logger.log(
        `[companyId=${company.id}] Excel generado por SIIGO`,
        {
          fileId: report.file_id,
          fileUrl: report.file_url,
        },
      );

      const excelBuffer = await this.siigoHttpClient.downloadExternalFile(
        report.file_url,
      );

      const summary = await this.persistBalanceTrialRows(
        parseBalanceTrialExcel(excelBuffer),
        company.id,
      );

      return {
        ...summary,
        fileId: report.file_id,
        fileUrl: report.file_url,
      };
    } catch (error) {
      handleSiigoApiError(
        this.logger,
        error,
        'importar balance de prueba por tercero desde SIIGO',
      );
    }
  }

  private async importBalanceTrialFromBuffer(
    buffer: Buffer,
    companyId: string,
    sourceLabel: string,
  ): Promise<ImportBalanceTrialResponseDto> {
    const company = await resolveSiigoCompany(
      this.companiesRepository,
      companyId,
    );

    this.logger.log(
      `[companyId=${company.id}] Iniciando importación de Balance de Prueba por Terceros (${sourceLabel})`,
    );

    const rows = parseBalanceTrialExcel(buffer);

    return this.persistBalanceTrialRows(rows, company.id);
  }

  private async persistBalanceTrialRows(
    rows: BalanceTrialExcelRow[],
    companyId: string,
  ): Promise<ImportBalanceTrialResponseDto> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const { rows: limitedRows, skippedRows } = limitBalanceTrialRows(
      rows,
      BALANCE_TRIAL_MAX_SUPPLIERS,
    );

    this.logger.log(
      `[companyId=${companyId}] Filas en Excel: ${rows.length}, filas a procesar: ${limitedRows.length}, proveedores máximos: ${BALANCE_TRIAL_MAX_SUPPLIERS}, filas omitidas: ${skippedRows}`,
    );

    const existingConfigurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );

    const configurationByDocument = new Map<string, SupplierConfiguration>();

    for (const configuration of existingConfigurations) {
      configurationByDocument.set(
        normalizeSupplierDocument(configuration.supplierDocument),
        configuration,
      );
    }

    const summary: ImportBalanceTrialResponseDto = {
      processedRows: 0,
      suppliersCreated: 0,
      suppliersUpdated: 0,
      accountsAdded: 0,
      duplicatedAccounts: 0,
    };

    const configurationsToSave = new Map<string, SupplierConfiguration>();
    const updatedSuppliers = new Set<string>();

    for (const row of limitedRows) {
      const supplierDocument = normalizeSupplierDocument(row.identification);

      if (!supplierDocument) {
        continue;
      }

      summary.processedRows += 1;

      let configuration = configurationByDocument.get(supplierDocument);
      let isNewConfiguration = false;
      let supplierUpdated = false;

      if (!configuration) {
        configuration = this.supplierConfigurationsRepository.create({
          companyId,
          integrationId: integration.id,
          supplierDocument,
          supplierDocumentType: 'NIT',
          supplierName: row.supplierName,
          itemType: SIIGO_DEFAULT_ITEM_TYPE,
          mappingValue: null,
          autoApply: false,
        });

        configurationByDocument.set(supplierDocument, configuration);
        isNewConfiguration = true;
        summary.suppliersCreated += 1;
      } else if (
        row.supplierName &&
        row.supplierName !== configuration.supplierName
      ) {
        configuration.supplierName = row.supplierName;
        supplierUpdated = true;
      }

      const { mappingValue, added, incremented } = addAccountToSupplierMapping(
        configuration.mappingValue,
        {
          code: row.accountCode,
          name: row.accountName,
        },
      );

      configuration.mappingValue = mappingValue;

      if (added) {
        summary.accountsAdded += 1;

        if (!isNewConfiguration) {
          supplierUpdated = true;
        }
      } else if (incremented) {
        summary.duplicatedAccounts += 1;
        supplierUpdated = true;
      }

      if (supplierUpdated && updatedSuppliers.add(supplierDocument)) {
        summary.suppliersUpdated += 1;
      }

      configurationsToSave.set(supplierDocument, configuration);
    }

    const configurations = [...configurationsToSave.values()];

    await this.dataSource.transaction(async (manager) => {
      await this.saveConfigurationsInBatches(manager, configurations);
    });

    this.logger.log(
      `[companyId=${companyId}] Importación finalizada: processedRows=${summary.processedRows}, suppliersSaved=${configurations.length}, suppliersLimit=${BALANCE_TRIAL_MAX_SUPPLIERS}, skippedRows=${skippedRows}, suppliersCreated=${summary.suppliersCreated}, suppliersUpdated=${summary.suppliersUpdated}, accountsAdded=${summary.accountsAdded}, duplicatedAccounts=${summary.duplicatedAccounts}`,
    );

    return summary;
  }

  private async saveConfigurationsInBatches(
    manager: EntityManager,
    configurations: SupplierConfiguration[],
  ): Promise<void> {
    for (
      let index = 0;
      index < configurations.length;
      index += BALANCE_TRIAL_SAVE_BATCH_SIZE
    ) {
      const batch = configurations.slice(
        index,
        index + BALANCE_TRIAL_SAVE_BATCH_SIZE,
      );

      await manager.save(SupplierConfiguration, batch);
    }
  }
}
