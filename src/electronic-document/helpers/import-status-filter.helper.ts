import { Brackets, SelectQueryBuilder } from 'typeorm';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';

export const IMPORT_ROW_STATUS_FILTER = {
  PENDIENTE: 'PENDIENTE',
  /** Solo Factura de compra SIIGO: subconjunto de PENDIENTE donde además
   * `requiresReview` es true (ver resolvePurchaseInvoiceRequiresReview). A
   * nivel SQL es indistinguible de PENDIENTE — ambos usan el MISMO bracket
   * acá abajo — el recorte exacto a uno u otro lo hace el service en JS
   * (ver needsPurchaseInvoiceReviewNarrowing en electronic-document.service),
   * porque requiresReview depende de datos resueltos por proveedor que no
   * viven en una columna. */
  REQUIERE_REVISION: 'REQUIERE REVISIÓN',
  EN_PROCESO: 'EN PROCESO',
  REQUIERE_PROVEEDOR: 'REQUIERE PROVEEDOR',
  LISTA: 'LISTA',
  /** Subconjunto de LISTA donde `alreadyInSiigo = true` — a diferencia de
   * REQUIERE_REVISION, esto SÍ es una columna real, así que el recorte es
   * puro SQL, sin narrowing en JS. */
  EXISTENTE_EN_SIIGO: 'EXISTENTE EN SIIGO',
  ERROR: 'ERROR',
} as const;

export type ImportRowStatusFilter =
  (typeof IMPORT_ROW_STATUS_FILTER)[keyof typeof IMPORT_ROW_STATUS_FILTER];

export const COMPLETED_STATUSES = [ElectronicDocumentStatus.PURCHASE_CREATED];

export const FAILED_STATUSES = [
  ElectronicDocumentStatus.PURCHASE_FAILED,
  ElectronicDocumentStatus.FAILED,
];

export function parseImportStatusFilters(
  raw?: string,
): ImportRowStatusFilter[] {
  if (!raw?.trim()) {
    return [];
  }

  const allowed = new Set<string>(Object.values(IMPORT_ROW_STATUS_FILTER));

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is ImportRowStatusFilter => allowed.has(value));
}

/** Mismo criterio que el bracket PENDIENTE de abajo, para usarlo en JS sobre
 * documentos ya traídos (ver needsPurchaseInvoiceReviewNarrowing en el
 * service) — evita duplicar la condición con otro significado. */
export function isPendienteEquivalentDocument(document: {
  status: string;
  supplierExistsInSiigo: boolean | null;
}): boolean {
  const excluded: string[] = [...FAILED_STATUSES, ...COMPLETED_STATUSES];
  return (
    document.supplierExistsInSiigo === true &&
    !excluded.includes(document.status)
  );
}

export function applyImportStatusFilters(
  query: SelectQueryBuilder<ElectronicDocument>,
  statuses: ImportRowStatusFilter[],
): void {
  if (!statuses.length) {
    return;
  }

  query.andWhere(
    new Brackets((statusQuery) => {
      for (const status of statuses) {
        statusQuery.orWhere(
          new Brackets((singleStatusQuery) => {
            switch (status) {
              case IMPORT_ROW_STATUS_FILTER.LISTA:
                singleStatusQuery
                  .where('document.status IN (:...completedStatuses)', {
                    completedStatuses: COMPLETED_STATUSES,
                  })
                  .andWhere('document.alreadyInSiigo = false');
                break;
              case IMPORT_ROW_STATUS_FILTER.EXISTENTE_EN_SIIGO:
                singleStatusQuery
                  .where('document.status IN (:...completedStatuses)', {
                    completedStatuses: COMPLETED_STATUSES,
                  })
                  .andWhere('document.alreadyInSiigo = true');
                break;
              case IMPORT_ROW_STATUS_FILTER.ERROR:
                singleStatusQuery.where(
                  'document.status IN (:...failedStatuses)',
                  { failedStatuses: FAILED_STATUSES },
                );
                break;
              case IMPORT_ROW_STATUS_FILTER.EN_PROCESO:
                singleStatusQuery
                  .where('document.supplierExistsInSiigo IS NULL')
                  .andWhere(
                    'document.status NOT IN (:...supplierResolvedStatuses)',
                    {
                      supplierResolvedStatuses: [
                        ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
                        ...COMPLETED_STATUSES,
                      ],
                    },
                  );
                break;
              case IMPORT_ROW_STATUS_FILTER.REQUIERE_PROVEEDOR:
                singleStatusQuery
                  .where(
                    new Brackets((supplierMissingQuery) => {
                      supplierMissingQuery
                        .where('document.supplierExistsInSiigo = false')
                        .orWhere(
                          'document.status = :supplierNotFoundStatus',
                          {
                            supplierNotFoundStatus:
                              ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
                          },
                        );
                    }),
                  )
                  .andWhere('document.status NOT IN (:...failedOrCompletedStatuses)', {
                    failedOrCompletedStatuses: [
                      ...FAILED_STATUSES,
                      ...COMPLETED_STATUSES,
                    ],
                  });
                break;
              case IMPORT_ROW_STATUS_FILTER.PENDIENTE:
              case IMPORT_ROW_STATUS_FILTER.REQUIERE_REVISION:
                singleStatusQuery
                  .where('document.supplierExistsInSiigo = true')
                  .andWhere('document.status NOT IN (:...pendingExcludedStatuses)', {
                    pendingExcludedStatuses: [
                      ...FAILED_STATUSES,
                      ...COMPLETED_STATUSES,
                    ],
                  });
                break;
              default:
                break;
            }
          }),
        );
      }
    }),
  );
}
