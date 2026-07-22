import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ImportBalanceTrialRequestDto,
  ImportBalanceTrialResponseDto,
} from './dto/import-balance-trial-response.dto';
import { SiigoAccountsBalanceSyncService } from './siigo-accounts-balance-sync.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';

@Injectable()
export class SiigoBalanceTrialImportService {
  private readonly logger = new Logger(SiigoBalanceTrialImportService.name);

  constructor(
    private readonly siigoAccountsBalanceSyncService: SiigoAccountsBalanceSyncService,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
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
    this.logger.log(
      `[companyId=${companyId}] Solicitando Balance de Prueba general a SIIGO (importación manual)`,
      request,
    );

    const summary =
      await this.siigoAccountsBalanceSyncService.syncAccountsFromManualImport(
        companyId,
        request,
      );

    this.siigoConfigurationCacheService.invalidateCompanyCache(companyId);

    return {
      processedRows: summary.processedRows,
      accountsCreated: summary.accountsCreated,
      accountsUpdated: summary.accountsUpdated,
      skippedRows: summary.skippedRows,
      yearsProcessed: summary.reportsProcessed,
    };
  }

  private async importBalanceTrialFromBuffer(
    buffer: Buffer,
    companyId: string,
    sourceLabel: string,
  ): Promise<ImportBalanceTrialResponseDto> {
    this.logger.log(
      `[companyId=${companyId}] Iniciando importación de Balance de Prueba general (${sourceLabel})`,
    );

    const summary =
      await this.siigoAccountsBalanceSyncService.syncAccountsFromExcelBuffer(
        companyId,
        buffer,
      );

    this.siigoConfigurationCacheService.invalidateCompanyCache(companyId);

    return {
      processedRows: summary.processedRows,
      accountsCreated: summary.accountsCreated,
      accountsUpdated: summary.accountsUpdated,
      skippedRows: summary.skippedRows,
      yearsProcessed: summary.reportsProcessed,
    };
  }
}
