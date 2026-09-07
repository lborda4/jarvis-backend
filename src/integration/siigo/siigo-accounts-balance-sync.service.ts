import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { SiigoAccount } from '../entities/siigo-account.entity';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import {
  BALANCE_TRIAL_SAVE_BATCH_SIZE,
} from './constants/supplier-configuration.constants';
import {
  BalanceTrialExcelRow,
  dedupeBalanceTrialRows,
  parseBalanceTrialExcel,
} from './helpers/balance-trial-excel.helper';
import {
  buildBalanceTrialAutoSyncReportRequests,
  buildBalanceTrialReportRequests,
} from './helpers/balance-trial-report-request.helper';
import { ImportBalanceTrialRequestDto } from './dto/import-balance-trial-response.dto';
import { SiigoTestBalanceReportRequest } from './interfaces/siigo-api.interface';
import {
  getSiigoIntegration,
  resolveSiigoCompany,
} from './helpers/siigo-context.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { handleSiigoApiError } from './helpers/siigo-error.helper';
import { SiigoAuthService } from './siigo-auth.service';

export interface SiigoAccountsBalanceSyncSummary {
  processedRows: number;
  accountsCreated: number;
  accountsUpdated: number;
  skippedRows: number;
  reportsProcessed: number;
}

/** Mismo período que la caché de catálogo SIIGO en memoria — no tiene
 * sentido persistir un throttle más corto que eso. */
const RECENT_MONTHS_AUTO_SYNC_TTL_MS = 24 * 60 * 60 * 1000;

interface PersistBalanceTrialOptions {
  onlyMissing?: boolean;
}

@Injectable()
export class SiigoAccountsBalanceSyncService {
  private readonly logger = new Logger(SiigoAccountsBalanceSyncService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly companiesRepository: CompaniesRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async syncAccountsFromRecentMonths(
    companyId: string,
  ): Promise<SiigoAccountsBalanceSyncSummary> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    if (
      integration.lastBalanceTrialAutoSyncAt &&
      Date.now() - integration.lastBalanceTrialAutoSyncAt.getTime() <
        RECENT_MONTHS_AUTO_SYNC_TTL_MS
    ) {
      this.logger.log(
        `[companyId=${companyId}] Auto-sync de balance de prueba omitido, ya corrió recientemente (lastRun=${integration.lastBalanceTrialAutoSyncAt.toISOString()})`,
      );

      return {
        processedRows: 0,
        accountsCreated: 0,
        accountsUpdated: 0,
        skippedRows: 0,
        reportsProcessed: 0,
      };
    }

    const reportRequests = buildBalanceTrialAutoSyncReportRequests();

    this.logger.log(
      `[companyId=${companyId}] Sincronizando cuentas desde balance de prueba (mes actual y anterior)`,
      reportRequests,
    );

    const summary = await this.syncAccountsFromSiigoReports(
      companyId,
      reportRequests,
      { onlyMissing: true },
    );

    integration.lastBalanceTrialAutoSyncAt = new Date();
    await this.integrationsRepository.save(integration);

    return summary;
  }

  async syncAccountsFromManualImport(
    companyId: string,
    request?: ImportBalanceTrialRequestDto,
  ): Promise<SiigoAccountsBalanceSyncSummary> {
    const reportRequests = buildBalanceTrialReportRequests(request);

    return this.syncAccountsFromSiigoReports(companyId, reportRequests);
  }

  async syncAccountsFromExcelBuffer(
    companyId: string,
    buffer: Buffer,
  ): Promise<SiigoAccountsBalanceSyncSummary> {
    return this.persistBalanceTrialRows(
      parseBalanceTrialExcel(buffer),
      companyId,
      1,
    );
  }

  private async syncAccountsFromSiigoReports(
    companyId: string,
    reportRequests: SiigoTestBalanceReportRequest[],
    options?: PersistBalanceTrialOptions,
  ): Promise<SiigoAccountsBalanceSyncSummary> {
    await resolveSiigoCompany(this.companiesRepository, companyId);

    const parsedRows: BalanceTrialExcelRow[] = [];

    try {
      for (const reportRequest of reportRequests) {
        const report = await executeSiigoRequestWithRetries(
          this.siigoAuthService,
          companyId,
          this.logger,
          `generar balance de prueba general (${reportRequest.year}-${reportRequest.month_start})`,
          (accessToken, partnerId) =>
            this.siigoHttpClient.createTestBalanceReport(
              accessToken,
              reportRequest,
              partnerId,
            ),
        );

        if (!report.file_url?.trim()) {
          throw new Error(
            `SIIGO no devolvió una URL válida para descargar el balance de prueba (${reportRequest.year}-${reportRequest.month_start}).`,
          );
        }

        const excelBuffer = await this.siigoHttpClient.downloadExternalFile(
          report.file_url,
        );

        parsedRows.push(...parseBalanceTrialExcel(excelBuffer));
      }
    } catch (error) {
      handleSiigoApiError(
        this.logger,
        error,
        'sincronizar cuentas desde balance de prueba general',
      );
    }

    return this.persistBalanceTrialRows(
      parsedRows,
      companyId,
      reportRequests.length,
      options,
    );
  }

  private async persistBalanceTrialRows(
    rows: BalanceTrialExcelRow[],
    companyId: string,
    reportsProcessed: number,
    options?: PersistBalanceTrialOptions,
  ): Promise<SiigoAccountsBalanceSyncSummary> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const uniqueRows = dedupeBalanceTrialRows(rows);
    const skippedRows = rows.length - uniqueRows.length;
    const existingAccounts =
      await this.siigoAccountsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );

    const accountByCode = new Map<string, SiigoAccount>();

    for (const account of existingAccounts) {
      accountByCode.set(account.code.trim(), account);
    }

    const summary: SiigoAccountsBalanceSyncSummary = {
      processedRows: uniqueRows.length,
      accountsCreated: 0,
      accountsUpdated: 0,
      skippedRows,
      reportsProcessed,
    };

    const accountsToSave: SiigoAccount[] = [];

    for (const row of uniqueRows) {
      if (!row.isTransactional) {
        summary.skippedRows += 1;
        continue;
      }

      const code = row.accountCode.trim();
      const name = row.accountName.trim() || code;
      const existingAccount = accountByCode.get(code);

      if (!existingAccount) {
        const account = this.siigoAccountsRepository.create({
          companyId,
          integrationId: integration.id,
          code,
          name,
          isTransactional: true,
        });

        accountByCode.set(code, account);
        accountsToSave.push(account);
        summary.accountsCreated += 1;
        continue;
      }

      if (options?.onlyMissing) {
        if (!existingAccount.isTransactional) {
          existingAccount.isTransactional = true;
          accountsToSave.push(existingAccount);
          summary.accountsUpdated += 1;
        }
        continue;
      }

      if (existingAccount.name !== name) {
        existingAccount.name = name;
        existingAccount.isTransactional = true;
        accountsToSave.push(existingAccount);
        summary.accountsUpdated += 1;
      } else if (!existingAccount.isTransactional) {
        existingAccount.isTransactional = true;
        accountsToSave.push(existingAccount);
        summary.accountsUpdated += 1;
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await this.saveAccountsInBatches(manager, accountsToSave);
    });

    this.logger.log(
      `[companyId=${companyId}] Sincronización de cuentas finalizada: processedRows=${summary.processedRows}, accountsCreated=${summary.accountsCreated}, accountsUpdated=${summary.accountsUpdated}, skippedRows=${summary.skippedRows}, reportsProcessed=${summary.reportsProcessed}`,
    );

    return summary;
  }

  private async saveAccountsInBatches(
    manager: EntityManager,
    accounts: SiigoAccount[],
  ): Promise<void> {
    for (
      let index = 0;
      index < accounts.length;
      index += BALANCE_TRIAL_SAVE_BATCH_SIZE
    ) {
      const batch = accounts.slice(index, index + BALANCE_TRIAL_SAVE_BATCH_SIZE);

      await manager.getRepository(SiigoAccount).save(batch);
    }
  }
}
