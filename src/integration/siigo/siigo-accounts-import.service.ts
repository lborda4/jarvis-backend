import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { SiigoAccount } from '../entities/siigo-account.entity';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { getSiigoIntegration } from './helpers/siigo-context.helper';
import { parseAccountsExcel } from './helpers/accounts-excel.helper';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { ImportSiigoAccountsResponseDto } from './dto/import-siigo-accounts-response.dto';

const ACCOUNTS_SAVE_BATCH_SIZE = 500;

/**
 * Carga el plan de cuentas desde el Excel que exporta SIIGO. Reemplaza a la
 * importación del Balance de Prueba, que deducía las cuentas de los
 * movimientos de los últimos años: acá vienen todas las cuentas del PUC de la
 * empresa, y el filtro de cuáles sirven para contabilizar lo hace el parser
 * (ver parseAccountsExcel).
 */
@Injectable()
export class SiigoAccountsImportService {
  private readonly logger = new Logger(SiigoAccountsImportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async importFromExcel(
    file: Express.Multer.File | undefined,
    companyId: string,
  ): Promise<ImportSiigoAccountsResponseDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Debe adjuntar el archivo de Excel con las cuentas contables.',
      );
    }

    this.logger.log(
      `[companyId=${companyId}] Importando cuentas contables desde ${file.originalname ?? 'archivo.xlsx'}`,
    );

    const { rows, skippedRows } = parseAccountsExcel(file.buffer);
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const existingAccounts =
      await this.siigoAccountsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );
    const accountByCode = new Map<string, SiigoAccount>(
      existingAccounts.map((account) => [account.code.trim(), account]),
    );

    const accountsToSave: SiigoAccount[] = [];
    let accountsCreated = 0;
    let accountsUpdated = 0;

    for (const row of rows) {
      const existingAccount = accountByCode.get(row.accountCode);

      if (!existingAccount) {
        accountsToSave.push(
          this.siigoAccountsRepository.create({
            companyId,
            integrationId: integration.id,
            code: row.accountCode,
            name: row.accountName,
            isTransactional: true,
          }),
        );
        accountsCreated += 1;
        continue;
      }

      if (
        existingAccount.name !== row.accountName ||
        !existingAccount.isTransactional
      ) {
        existingAccount.name = row.accountName;
        existingAccount.isTransactional = true;
        accountsToSave.push(existingAccount);
        accountsUpdated += 1;
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await this.saveAccountsInBatches(manager, accountsToSave);
    });

    this.siigoConfigurationCacheService.invalidateCompanyCache(companyId);

    this.logger.log(
      `[companyId=${companyId}] Cuentas contables importadas: procesadas=${rows.length}, creadas=${accountsCreated}, actualizadas=${accountsUpdated}, omitidas=${skippedRows}`,
    );

    return {
      processedRows: rows.length,
      accountsCreated,
      accountsUpdated,
      skippedRows,
    };
  }

  /** Por lotes: el PUC completo de una empresa puede traer miles de filas y
   * un solo INSERT con todas se pasa del límite de parámetros de Postgres. */
  private async saveAccountsInBatches(
    manager: EntityManager,
    accounts: SiigoAccount[],
  ): Promise<void> {
    for (
      let index = 0;
      index < accounts.length;
      index += ACCOUNTS_SAVE_BATCH_SIZE
    ) {
      await manager.save(
        SiigoAccount,
        accounts.slice(index, index + ACCOUNTS_SAVE_BATCH_SIZE),
      );
    }
  }
}
