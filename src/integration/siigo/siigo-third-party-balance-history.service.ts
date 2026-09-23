import { Injectable, Logger } from '@nestjs/common';
import { HistorialFactura } from '../entities/historial-factura.entity';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { HistorialFacturaTipo } from '../enums/historial-factura-tipo.enum';
import { HistorialFacturasRepository } from '../repositories/historial-facturas.repository';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import {
  parseThirdPartyBalanceExcel,
  ThirdPartyBalanceExcelRow,
} from './helpers/third-party-balance-excel.helper';
import { SiigoAuthService } from './siigo-auth.service';

const HISTORY_YEARS = 2;
const REPORT_DESCRIPTION = 'Referencia de balance por tercero';

interface YearBalanceRow extends ThirdPartyBalanceExcelRow {
  year: number;
}

@Injectable()
export class SiigoThirdPartyBalanceHistoryService {
  private readonly logger = new Logger(
    SiigoThirdPartyBalanceHistoryService.name,
  );

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly historialFacturasRepository: HistorialFacturasRepository,
  ) {}

  async replaceHistory(
    companyId: string,
    integrationId: string,
  ): Promise<number> {
    const rows: YearBalanceRow[] = [];
    const errors: unknown[] = [];
    let successfulReports = 0;

    for (const year of this.previousYears()) {
      try {
        const report = await executeSiigoRequestWithRetries(
          this.siigoAuthService,
          companyId,
          this.logger,
          `generar balance de prueba por tercero (${year})`,
          (accessToken, partnerId) =>
            this.siigoHttpClient.createTestBalanceByThirdPartyReport(
              accessToken,
              {
                year,
                month_start: 1,
                month_end: 13,
                includes_tax_difference: true,
              },
              partnerId,
            ),
        );

        if (!report.file_url?.trim()) {
          throw new Error(
            `SIIGO no devolvió una URL para el balance por tercero de ${year}.`,
          );
        }

        const excel = await this.siigoHttpClient.downloadExternalFile(
          report.file_url,
        );

        rows.push(
          ...parseThirdPartyBalanceExcel(excel).map((row) => ({
            ...row,
            year,
          })),
        );
        successfulReports++;
      } catch (error) {
        errors.push(error);
        this.logger.warn(
          `[companyId=${companyId}] No se pudo importar el balance por tercero de ${year}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (successfulReports === 0 && errors.length > 0) {
      throw errors[0];
    }

    const historyRows = rows.map((row) =>
      this.buildHistoryRow(companyId, integrationId, row),
    );

    await this.historialFacturasRepository.replaceRowsBySource(
      companyId,
      integrationId,
      HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
      historyRows,
    );

    this.logger.log(
      `[companyId=${companyId}] Fallback de balance por tercero completado: ${historyRows.length} referencia(s) de tercero/cuenta en ${successfulReports} reporte(s).`,
    );

    return historyRows.length;
  }

  clearHistory(companyId: string, integrationId: string): Promise<void> {
    return this.historialFacturasRepository.replaceRowsBySource(
      companyId,
      integrationId,
      HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
      [],
    );
  }

  private previousYears(now = new Date()): number[] {
    const currentYear = now.getUTCFullYear();
    return Array.from(
      { length: HISTORY_YEARS },
      (_, index) => currentYear - index - 1,
    );
  }

  private buildHistoryRow(
    companyId: string,
    integrationId: string,
    row: YearBalanceRow,
  ): HistorialFactura {
    return this.historialFacturasRepository.create({
      companyId,
      integrationId,
      facturaId: `balance-tercero:${row.year}:${row.supplierDocument}:${row.accountCode}`,
      proveedorNit: row.supplierDocument,
      descripcionItem: REPORT_DESCRIPTION,
      tipo: HistorialFacturaTipo.CUENTA,
      cuentaPuc: row.accountCode,
      impuestos: {},
      metodoPagoId: null,
      metodoPagoNombre: null,
      metodoPagoType: null,
      metodoPagoDueDate: null,
      providerInvoicePrefix: null,
      providerInvoiceNumber: null,
      siigoNumero: null,
      fuente: HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
      fechaFactura: `${row.year}-12-31`,
    });
  }
}
