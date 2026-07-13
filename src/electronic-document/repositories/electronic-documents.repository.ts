import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';

export interface FindElectronicDocumentsFilters {
  electronicDocumentType?: ElectronicDocumentType;
  status?: string;
  companyId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  page: number;
  limit: number;
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
      | 'processingStatus'
      | 'supplierExistsInSiigo'
      | 'recommendedAccount'
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

    const total = await query.getCount();
    const items = await query
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getMany();

    return { items, total };
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
