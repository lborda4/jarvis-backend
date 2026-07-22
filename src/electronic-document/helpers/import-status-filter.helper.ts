import { Brackets, SelectQueryBuilder } from 'typeorm';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';

export const IMPORT_ROW_STATUS_FILTER = {
  PENDIENTE: 'PENDIENTE',
  EN_PROCESO: 'EN PROCESO',
  REQUIERE_PROVEEDOR: 'REQUIERE PROVEEDOR',
  LISTA: 'LISTA',
  ERROR: 'ERROR',
} as const;

export type ImportRowStatusFilter =
  (typeof IMPORT_ROW_STATUS_FILTER)[keyof typeof IMPORT_ROW_STATUS_FILTER];

const COMPLETED_STATUSES = [ElectronicDocumentStatus.PURCHASE_CREATED];

const FAILED_STATUSES = [
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
                singleStatusQuery.where(
                  'document.status IN (:...completedStatuses)',
                  { completedStatuses: COMPLETED_STATUSES },
                );
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
