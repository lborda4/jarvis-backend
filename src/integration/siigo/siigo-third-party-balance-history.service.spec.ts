import * as XLSX from 'xlsx';
import { HistorialFactura } from '../entities/historial-factura.entity';
import { HistorialFacturaFuente } from '../enums/historial-factura-fuente.enum';
import { SiigoTestBalanceByThirdPartyReportRequest } from './interfaces/siigo-api.interface';
import { SiigoThirdPartyBalanceHistoryService } from './siigo-third-party-balance-history.service';

function buildExcel(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Código cuenta contable', 'Identificación tercero'],
      ['51359501', '900123456'],
    ]),
    'Balance',
  );
  const output: unknown = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });

  if (!Buffer.isBuffer(output)) {
    throw new Error('No se pudo construir el Excel de prueba.');
  }

  return output;
}

describe('SiigoThirdPartyBalanceHistoryService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('consulta los dos años anteriores y reemplaza el historial auxiliar', async () => {
    const siigoAuthService = {
      getValidAuthContext: jest.fn().mockResolvedValue({
        accessToken: 'token',
        partnerId: 'partner',
      }),
    };
    const siigoHttpClient = {
      createTestBalanceByThirdPartyReport: jest
        .fn()
        .mockImplementation(
          (
            _token: string,
            payload: SiigoTestBalanceByThirdPartyReportRequest,
          ) =>
            Promise.resolve({
              file_id: `file-${payload.year}`,
              file_url: `https://reports.test/${payload.year}.xlsx`,
            }),
        ),
      downloadExternalFile: jest.fn().mockResolvedValue(buildExcel()),
    };
    const historialFacturasRepository = {
      create: jest
        .fn()
        .mockImplementation(
          (row: Partial<HistorialFactura>) => row as HistorialFactura,
        ),
      replaceRowsBySource: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SiigoThirdPartyBalanceHistoryService(
      siigoAuthService as any,
      siigoHttpClient as any,
      historialFacturasRepository as any,
    );

    await expect(
      service.replaceHistory('company-1', 'integration-1'),
    ).resolves.toBe(2);

    expect(
      siigoHttpClient.createTestBalanceByThirdPartyReport,
    ).toHaveBeenNthCalledWith(
      1,
      'token',
      {
        year: 2025,
        month_start: 1,
        month_end: 13,
        includes_tax_difference: true,
      },
      'partner',
    );
    expect(
      siigoHttpClient.createTestBalanceByThirdPartyReport,
    ).toHaveBeenNthCalledWith(
      2,
      'token',
      {
        year: 2024,
        month_start: 1,
        month_end: 13,
        includes_tax_difference: true,
      },
      'partner',
    );
    expect(
      historialFacturasRepository.replaceRowsBySource,
    ).toHaveBeenCalledWith(
      'company-1',
      'integration-1',
      HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
      expect.arrayContaining([
        expect.objectContaining({
          proveedorNit: '900123456',
          cuentaPuc: '51359501',
          facturaId: 'balance-tercero:2025:900123456:51359501',
        }),
      ]),
    );
  });
});
