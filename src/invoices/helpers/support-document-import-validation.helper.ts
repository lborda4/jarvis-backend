import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';
import { SiigoCostCenterCatalogItemDto } from '../../integration/siigo/dto/list-siigo-cost-centers.dto';
import { resolveSiigoCostCenter } from '../../integration/siigo/helpers/siigo-cost-center-match.helper';

/** Valores canónicos que puede devolver normalizeSupportDocumentType — si el
 * Excel trae algo que no cae en ninguno de estos (typo, tipo de documento
 * que no existe), esa función igual devuelve ALGO (el texto original en
 * mayúsculas, ver su fallback), así que hay que revalidar acá contra el
 * catálogo real en vez de confiar en que "no vino vacío" ya es suficiente. */
const VALID_SUPPORT_DOCUMENT_TYPES = new Set(['NIT', 'CC', 'CE', 'PA']);

export interface SupportDocumentValidationRowError {
  groupKey: string;
  /** "Prefijo+Consecutivo (NIT proveedor)" — la referencia que el usuario
   * puede buscar en el Excel para encontrar la fila; no es un número de
   * fila crudo porque un Documento Soporte agrupa varias filas (ítems) bajo
   * el mismo proveedor+consecutivo. */
  reference: string;
  reason: string;
}

export interface SupportDocumentValidationReport {
  totalGroups: number;
  validGroups: number;
  invalidGroups: number;
  errors: SupportDocumentValidationRowError[];
}

/**
 * Pasada de validación rápida (sin tocar NextPyme/SIIGO) sobre los grupos ya
 * parseados del Excel de Documento Soporte: tipo de documento del proveedor
 * (debe ser un tipo real, no cualquier texto) y centro de costos (si viene,
 * debe existir en el catálogo real de la empresa — vacío sí pasa). Se corre
 * ANTES de confirmar la importación, mismo criterio que
 * validatePurchaseInvoiceExcelRows: el usuario revisa el reporte y corrige
 * el Excel antes de disparar ninguna llamada real.
 */
export function validateSupportDocumentExcelRows(
  groups: GroupedSupportDocument[],
  costCenters: SiigoCostCenterCatalogItemDto[],
): SupportDocumentValidationReport {
  const errors: SupportDocumentValidationRowError[] = [];
  const invalidGroupKeys = new Set<string>();

  groups.forEach((group) => {
    const reference = `${group.documentPrefix}${group.documentNumber} (NIT ${group.supplierIdentification})`;

    const addError = (reason: string) => {
      errors.push({ groupKey: group.groupKey, reference, reason });
      invalidGroupKeys.add(group.groupKey);
    };

    const documentType = group.supplierDocumentType?.trim().toUpperCase();

    if (!documentType || !VALID_SUPPORT_DOCUMENT_TYPES.has(documentType)) {
      addError(
        `Tipo de documento inválido ("${group.supplierDocumentType || 'vacío'}") — debe ser NIT o CC.`,
      );
    }

    const costCenterText = group.costCenter?.trim();

    // Vacío SÍ pasa — el centro de costos es opcional. Solo se rechaza un
    // valor que no matchea NADA del catálogo real (typo, o un centro de
    // costos que ya no existe en SIIGO).
    if (costCenterText) {
      const matched = resolveSiigoCostCenter(costCenterText, costCenters);

      if (!matched) {
        addError(
          `Centro de costos "${costCenterText}" no existe en SIIGO — elegí uno de la lista desplegable o dejá la celda vacía.`,
        );
      }
    }
  });

  return {
    totalGroups: groups.length,
    validGroups: groups.length - invalidGroupKeys.size,
    invalidGroups: invalidGroupKeys.size,
    errors,
  };
}
