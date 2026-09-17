import { validateSupportDocumentExcelRows } from './support-document-import-validation.helper';
import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';
import { SiigoCostCenterCatalogItemDto } from '../../integration/siigo/dto/list-siigo-cost-centers.dto';

const COST_CENTERS: SiigoCostCenterCatalogItemDto[] = [
  { id: 1, code: '001', name: 'Administración' },
];

function buildGroup(
  overrides: Partial<GroupedSupportDocument> = {},
): GroupedSupportDocument {
  return {
    groupKey: 'group-1',
    supplierIdentification: '900123456',
    supplierDocumentType: 'NIT',
    supplierName: 'Proveedor',
    documentPrefix: 'DS',
    documentNumber: '100',
    issueDate: '2026-01-01',
    currency: 'COP',
    rows: [],
    ...overrides,
  };
}

describe('validateSupportDocumentExcelRows', () => {
  it('un grupo válido (tipo de documento real, sin centro de costos) no reporta errores', () => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup()],
      COST_CENTERS,
    );

    expect(report).toEqual({
      totalGroups: 1,
      validGroups: 1,
      invalidGroups: 0,
      errors: [],
    });
  });

  it('un grupo válido con centro de costos que sí existe en el catálogo no reporta errores', () => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup({ costCenter: '001 - Administración' })],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(0);
  });

  it.each([
    ['XYZ', 'texto que no es ningún tipo de documento real'],
    ['', 'vacío'],
  ])('rechaza tipo de documento inválido ("%s")', (invalidType) => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup({ supplierDocumentType: invalidType })],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(1);
    expect(report.errors[0].reason).toContain('Tipo de documento inválido');
  });

  it('acepta CC además de NIT (tipos ya soportados por normalizeSupportDocumentType)', () => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup({ supplierDocumentType: 'CC' })],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(0);
  });

  it('centro de costos vacío SIEMPRE pasa (es opcional)', () => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup({ costCenter: undefined })],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(0);
  });

  it('rechaza un centro de costos que no matchea nada del catálogo real (typo, o ya no existe)', () => {
    const report = validateSupportDocumentExcelRows(
      [buildGroup({ costCenter: 'Marketing' })],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(1);
    expect(report.errors[0].reason).toContain(
      'Centro de costos "Marketing" no existe',
    );
  });

  it('la referencia del error apunta al prefijo+consecutivo y NIT del grupo (lo que el usuario puede buscar en el Excel)', () => {
    const report = validateSupportDocumentExcelRows(
      [
        buildGroup({
          documentPrefix: 'DS',
          documentNumber: '2872',
          supplierIdentification: '1030648463',
          costCenter: 'Marketing',
        }),
      ],
      COST_CENTERS,
    );

    expect(report.errors[0].reference).toBe('DS2872 (NIT 1030648463)');
  });

  it('un grupo con dos errores (tipo inválido Y centro de costos inválido) solo cuenta una vez como grupo inválido', () => {
    const report = validateSupportDocumentExcelRows(
      [
        buildGroup({
          supplierDocumentType: 'XYZ',
          costCenter: 'Marketing',
        }),
      ],
      COST_CENTERS,
    );

    expect(report.invalidGroups).toBe(1);
    expect(report.errors).toHaveLength(2);
  });
});
