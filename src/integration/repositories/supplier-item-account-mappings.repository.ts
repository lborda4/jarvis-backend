import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierItemAccountMapping } from '../entities/supplier-item-account-mapping.entity';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';
import { normalizeItemDescription } from '../helpers/supplier-item-account-mapping.helper';

@Injectable()
export class SupplierItemAccountMappingsRepository {
  constructor(
    @InjectRepository(SupplierItemAccountMapping)
    private readonly repository: Repository<SupplierItemAccountMapping>,
  ) {}

  findByCompanyAndIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<SupplierItemAccountMapping[]> {
    return this.repository.find({ where: { companyId, integrationId } });
  }

  async findOneByKey(
    companyId: string,
    integrationId: string,
    supplierDocumentType: string,
    supplierDocument: string,
    description: string,
  ): Promise<SupplierItemAccountMapping | null> {
    return this.repository.findOne({
      where: {
        companyId,
        integrationId,
        supplierDocumentType: supplierDocumentType.trim() || 'NIT',
        supplierDocument: normalizeSupplierDocument(supplierDocument),
        descriptionNormalized: normalizeItemDescription(description),
      },
    });
  }

  /** Crea o actualiza la regla de (proveedor + descripción), incrementando
   * `confirmationsCount` cada vez que se aplica — uso automático incluido,
   * no solo confirmación manual del contador (así refleja qué tan usada/
   * confiable es la regla, no solo si un humano la tocó). */
  async upsertConfirmedAccount(params: {
    companyId: string;
    integrationId: string;
    supplierDocumentType: string;
    supplierDocument: string;
    description: string;
    accountCode: string;
    accountName?: string | null;
  }): Promise<SupplierItemAccountMapping> {
    const supplierDocumentType = params.supplierDocumentType.trim() || 'NIT';
    const supplierDocument = normalizeSupplierDocument(params.supplierDocument);
    const descriptionNormalized = normalizeItemDescription(params.description);

    const existing = await this.repository.findOne({
      where: {
        companyId: params.companyId,
        integrationId: params.integrationId,
        supplierDocumentType,
        supplierDocument,
        descriptionNormalized,
      },
    });

    const now = new Date();

    if (existing) {
      existing.accountCode = params.accountCode;
      existing.accountName = params.accountName ?? existing.accountName;
      existing.descriptionOriginal = params.description;
      existing.confirmationsCount += 1;
      existing.lastConfirmedAt = now;

      return this.repository.save(existing);
    }

    const created = this.repository.create({
      companyId: params.companyId,
      integrationId: params.integrationId,
      supplierDocumentType,
      supplierDocument,
      descriptionNormalized,
      descriptionOriginal: params.description,
      accountCode: params.accountCode,
      accountName: params.accountName ?? null,
      confirmationsCount: 1,
      lastConfirmedAt: now,
    });

    return this.repository.save(created);
  }
}
