import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';
import {
  IMPORT_ROW_STATUS_FILTER,
  isPendienteEquivalentDocument,
  parseImportStatusFilters,
} from './import-status-filter.helper';

describe('parseImportStatusFilters', () => {
  it('acepta los dos estados derivados nuevos (REQUIERE_REVISION, EXISTENTE_EN_SIIGO)', () => {
    const result = parseImportStatusFilters(
      'PENDIENTE,REQUIERE REVISIÓN,LISTA,EXISTENTE EN SIIGO',
    );

    expect(result).toEqual([
      IMPORT_ROW_STATUS_FILTER.PENDIENTE,
      IMPORT_ROW_STATUS_FILTER.REQUIERE_REVISION,
      IMPORT_ROW_STATUS_FILTER.LISTA,
      IMPORT_ROW_STATUS_FILTER.EXISTENTE_EN_SIIGO,
    ]);
  });

  it('descarta valores que no coinciden con ningún estado conocido', () => {
    expect(parseImportStatusFilters('PENDIENTE,INVENTADO')).toEqual([
      IMPORT_ROW_STATUS_FILTER.PENDIENTE,
    ]);
  });
});

/**
 * isPendienteEquivalentDocument es la versión en JS del bracket PENDIENTE de
 * applyImportStatusFilters (ver el comentario en el helper) — el filtro de
 * Pendiente/Requiere revisión en el service depende de que las DOS
 * condiciones coincidan exactamente: si una fila pasa el filtro SQL pero
 * esta función dice que no, o viceversa, el recorte fino en JS quedaría mal
 * (documentos "Pendiente" que no aparecen, o de otro estado que sí).
 */
describe('isPendienteEquivalentDocument', () => {
  it('true para un documento con proveedor confirmado y estado activo', () => {
    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        supplierExistsInSiigo: true,
      }),
    ).toBe(true);
  });

  it('false si el proveedor todavía no se confirmó en SIIGO', () => {
    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        supplierExistsInSiigo: null,
      }),
    ).toBe(false);

    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        supplierExistsInSiigo: false,
      }),
    ).toBe(false);
  });

  it('false si ya se envió a SIIGO (PURCHASE_CREATED)', () => {
    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.PURCHASE_CREATED,
        supplierExistsInSiigo: true,
      }),
    ).toBe(false);
  });

  it('false si el envío falló', () => {
    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.PURCHASE_FAILED,
        supplierExistsInSiigo: true,
      }),
    ).toBe(false);

    expect(
      isPendienteEquivalentDocument({
        status: ElectronicDocumentStatus.FAILED,
        supplierExistsInSiigo: true,
      }),
    ).toBe(false);
  });
});
