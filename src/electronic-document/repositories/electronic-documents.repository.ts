import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';
import {
  applyImportStatusFilters,
  IMPORT_ROW_STATUS_FILTER,
  ImportRowStatusFilter,
} from '../helpers/import-status-filter.helper';
import { ElectronicDocumentStatus } from '../enums/electronic-document-status.enum';

export interface FindElectronicDocumentsFilters {
  electronicDocumentType?: ElectronicDocumentType;
  status?: string;
  companyId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  supplierNits?: string[];
  issueDates?: string[];
  issueDateFrom?: string;
  issueDateTo?: string;
  siigoDocumentNumbers?: string[];
  importStatuses?: ImportRowStatusFilter[];
  page: number;
  limit: number;
}

export interface ElectronicDocumentFilterOptions {
  issueDates: string[];
  siigoDocumentNumbers: string[];
  importStatuses: ImportRowStatusFilter[];
  suppliers: Array<{ nit: string; name: string }>;
}

@Injectable()
export class ElectronicDocumentsRepository {
  constructor(
    @InjectRepository(ElectronicDocument)
    private readonly repository: Repository<ElectronicDocument>,
  ) {}

  create(
    data: Pick<
      ElectronicDocument,
      | 'companyId'
      | 'cufe'
      | 'documentNumberThird'
      | 'documentTypeThird'
      | 'electronicDocumentType'
      | 'status'
      | 'supplierExistsInSiigo'
      | 'payload'
    >,
  ): ElectronicDocument {
    return this.repository.create(data);
  }

  save(document: ElectronicDocument): Promise<ElectronicDocument> {
    return this.repository.save(document);
  }

  findById(id: string): Promise<ElectronicDocument | null> {
    return this.repository.findOne({
      where: { id },
      relations: { company: true },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  /** Variante en lote de findById+deleteById — evita 2×N round trips a la
   * BD (uno por documento) cuando se borran muchos registros de una vez
   * desde el dashboard; ver deleteLocalDocuments en el service. */
  findByCompanyAndIds(
    companyId: string,
    ids: string[],
  ): Promise<ElectronicDocument[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.repository.find({
      where: { companyId, id: In(ids) },
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.repository.delete({ id: In(ids) });
  }

  async findAll(
    filters: FindElectronicDocumentsFilters,
  ): Promise<{ items: ElectronicDocument[]; total: number }> {
    const query = this.repository
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.company', 'company')
      .orderBy('document.createdAt', 'DESC');

    if (filters.electronicDocumentType) {
      query.andWhere('document.electronicDocumentType = :electronicDocumentType', {
        electronicDocumentType: filters.electronicDocumentType,
      });
    }

    if (filters.status?.trim()) {
      query.andWhere('document.status = :status', {
        status: filters.status.trim(),
      });
    }

    if (filters.companyId?.trim()) {
      query.andWhere('document.companyId = :companyId', {
        companyId: filters.companyId.trim(),
      });
    }

    if (filters.dateFrom) {
      query.andWhere('document.createdAt >= :dateFrom', {
        dateFrom: filters.dateFrom,
      });
    }

    if (filters.dateTo) {
      query.andWhere('document.createdAt <= :dateTo', {
        dateTo: filters.dateTo,
      });
    }

    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query.andWhere(
        new Brackets((qb) => {
          qb.where('document.cufe ILIKE :term', { term })
            .orWhere('document.documentNumberThird ILIKE :term', { term })
            .orWhere("document.payload->'invoice'->>'number' ILIKE :term", {
              term,
            })
            .orWhere("document.payload->'supplier'->>'name' ILIKE :term", {
              term,
            })
            .orWhere(
              "document.payload->'supplier'->>'documentNumber' ILIKE :term",
              { term },
            );
        }),
      );
    }

    if (filters.supplierNits?.length) {
      query.andWhere('document.documentNumberThird IN (:...supplierNits)', {
        supplierNits: filters.supplierNits,
      });
    }

    if (filters.issueDates?.length) {
      query.andWhere(
        "document.payload->'invoice'->>'issueDate' IN (:...issueDates)",
        { issueDates: filters.issueDates },
      );
    }

    if (filters.issueDateFrom) {
      query.andWhere(
        "document.payload->'invoice'->>'issueDate' >= :issueDateFrom",
        { issueDateFrom: filters.issueDateFrom },
      );
    }

    if (filters.issueDateTo) {
      query.andWhere(
        "document.payload->'invoice'->>'issueDate' <= :issueDateTo",
        { issueDateTo: filters.issueDateTo },
      );
    }

    if (filters.siigoDocumentNumbers?.length) {
      query.andWhere(
        'document.siigoDocumentNumber IN (:...siigoDocumentNumbers)',
        { siigoDocumentNumbers: filters.siigoDocumentNumbers },
      );
    }

    applyImportStatusFilters(query, filters.importStatuses ?? []);

    const total = await query.getCount();
    const items = await query
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getMany();

    return { items, total };
  }

  async findFilterOptions(
    companyId: string,
    electronicDocumentType?: ElectronicDocumentType,
  ): Promise<ElectronicDocumentFilterOptions> {
    const baseQuery = this.repository
      .createQueryBuilder('document')
      .where('document.companyId = :companyId', { companyId });

    if (electronicDocumentType) {
      baseQuery.andWhere('document.electronicDocumentType = :electronicDocumentType', {
        electronicDocumentType,
      });
    }

    const issueDateRows = await baseQuery
      .clone()
      .select(
        "DISTINCT document.payload->'invoice'->>'issueDate'",
        'issueDate',
      )
      .andWhere("document.payload->'invoice'->>'issueDate' IS NOT NULL")
      .andWhere("document.payload->'invoice'->>'issueDate' <> ''")
      .orderBy("document.payload->'invoice'->>'issueDate'", 'ASC')
      .getRawMany<{ issueDate: string }>();

    const siigoNumberRows = await baseQuery
      .clone()
      .select('DISTINCT document.siigoDocumentNumber', 'siigoDocumentNumber')
      .andWhere('document.siigoDocumentNumber IS NOT NULL')
      .orderBy('document.siigoDocumentNumber', 'ASC')
      .getRawMany<{ siigoDocumentNumber: string }>();

    const supplierRows = await baseQuery
      .clone()
      .select('document.documentNumberThird', 'nit')
      .addSelect("document.payload->'supplier'->>'name'", 'name')
      .andWhere('document.documentNumberThird IS NOT NULL')
      .andWhere("document.documentNumberThird <> ''")
      .distinct(true)
      .orderBy("document.payload->'supplier'->>'name'", 'ASC')
      .getRawMany<{ nit: string; name: string | null }>();

    const statusRows = await baseQuery
      .clone()
      .select('document.status', 'status')
      .addSelect('document.supplierExistsInSiigo', 'supplierExistsInSiigo')
      .getRawMany<{
        status: string;
        supplierExistsInSiigo: boolean | null;
      }>();

    const importStatuses = new Set<ImportRowStatusFilter>();

    for (const row of statusRows) {
      importStatuses.add(
        mapRawDocumentToImportStatus(row.status, row.supplierExistsInSiigo),
      );
    }

    return {
      issueDates: issueDateRows
        .map((row) => row.issueDate?.trim())
        .filter((value): value is string => Boolean(value)),
      siigoDocumentNumbers: siigoNumberRows
        .map((row) => row.siigoDocumentNumber?.trim())
        .filter((value): value is string => Boolean(value)),
      importStatuses: [...importStatuses].sort((left, right) =>
        left.localeCompare(right, 'es', { sensitivity: 'base' }),
      ),
      suppliers: supplierRows
        .map((row) => ({
          nit: row.nit.trim(),
          name: row.name?.trim() || row.nit.trim(),
        }))
        .filter((supplier) => supplier.nit.length > 0),
    };
  }

  findByCompanySupplierAndStatus(
    companyId: string,
    documentNumberThird: string,
    status: ElectronicDocumentStatus,
    excludeId: string,
  ): Promise<ElectronicDocument[]> {
    return this.repository
      .createQueryBuilder('document')
      .where('document.companyId = :companyId', { companyId })
      .andWhere('document.documentNumberThird = :documentNumberThird', {
        documentNumberThird,
      })
      .andWhere('document.status = :status', { status })
      .andWhere('document.id != :excludeId', { excludeId })
      .getMany();
  }

  /** Documentos ya existentes para esas CUFEs en esa empresa — usado para no
   * duplicar un documento si una fila de import se reprocesa (ej. worker
   * caído justo después de crear el documento pero antes de guardar su id
   * en la fila del job). Devuelve un Map<cufe, documentId> para lookup O(1). */
  async findByCompanyAndCufes(
    companyId: string,
    cufes: string[],
  ): Promise<Map<string, string>> {
    if (cufes.length === 0) {
      return new Map();
    }

    const rows = await this.repository.find({
      where: { companyId, cufe: In(cufes) },
      select: { id: true, cufe: true },
    });

    return new Map(
      rows
        .filter((row): row is ElectronicDocument & { cufe: string } =>
          Boolean(row.cufe),
        )
        .map((row) => [row.cufe, row.id]),
    );
  }

  async findDistinctCompanies(): Promise<
    Array<{ id: string; name: string; nit: string }>
  > {
    const rows = await this.repository
      .createQueryBuilder('document')
      .innerJoin('document.company', 'company')
      .select('company.id', 'id')
      .addSelect('company.name', 'name')
      .addSelect('company.nit', 'nit')
      .distinct(true)
      .orderBy('company.name', 'ASC')
      .getRawMany<{ id: string; name: string; nit: string }>();

    return rows;
  }
}

function mapRawDocumentToImportStatus(
  status: string,
  supplierExistsInSiigo: boolean | null,
): ImportRowStatusFilter {
  if (status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return IMPORT_ROW_STATUS_FILTER.LISTA;
  }

  if (
    status === ElectronicDocumentStatus.PURCHASE_FAILED ||
    status === ElectronicDocumentStatus.FAILED
  ) {
    return IMPORT_ROW_STATUS_FILTER.ERROR;
  }

  if (
    supplierExistsInSiigo !== true &&
    supplierExistsInSiigo !== false &&
    status !== ElectronicDocumentStatus.SUPPLIER_NOT_FOUND &&
    status !== ElectronicDocumentStatus.PURCHASE_CREATED
  ) {
    return IMPORT_ROW_STATUS_FILTER.EN_PROCESO;
  }

  if (
    supplierExistsInSiigo === false ||
    status === ElectronicDocumentStatus.SUPPLIER_NOT_FOUND
  ) {
    return IMPORT_ROW_STATUS_FILTER.REQUIERE_PROVEEDOR;
  }

  return IMPORT_ROW_STATUS_FILTER.PENDIENTE;
}
