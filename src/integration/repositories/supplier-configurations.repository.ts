import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';

@Injectable()
export class SupplierConfigurationsRepository {
  constructor(
    @InjectRepository(SupplierConfiguration)
    private readonly repository: Repository<SupplierConfiguration>,
  ) {}

  findByCompanyIntegrationAndSupplierIdentity(
    companyId: string,
    integrationId: string,
    supplierDocumentType: string,
    supplierDocument: string,
  ): Promise<SupplierConfiguration | null> {
    return this.findByCompanyIntegrationAndNormalizedSupplierDocument(
      companyId,
      integrationId,
      supplierDocument,
    );
  }

  async findByCompanyIntegrationAndNormalizedSupplierDocument(
    companyId: string,
    integrationId: string,
    supplierDocument: string,
  ): Promise<SupplierConfiguration | null> {
    const normalizedDocument = normalizeSupplierDocument(supplierDocument);

    if (!normalizedDocument) {
      return null;
    }

    const configurations = await this.findByCompanyAndIntegration(
      companyId,
      integrationId,
    );

    return (
      configurations.find(
        (configuration) =>
          normalizeSupplierDocument(configuration.supplierDocument) ===
          normalizedDocument,
      ) ?? null
    );
  }

  findByCompanyAndIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<SupplierConfiguration[]> {
    return this.repository.find({
      where: { companyId, integrationId },
    });
  }

  /** Terceros creados AUTOMÁTICAMENTE en SIIGO (ver
   * SiigoDocumentPreparationService.tryAutoCreateSupplier) desde `since` —
   * se usa para avisarle al usuario cuántos y cuáles terceros se crearon
   * solos durante el import que acaba de disparar. Orden más reciente
   * primero, para que el mensaje muestre los últimos si hay muchos. */
  findAutoCreatedSince(
    companyId: string,
    integrationId: string,
    since: Date,
  ): Promise<SupplierConfiguration[]> {
    return this.repository.find({
      where: {
        companyId,
        integrationId,
        autoCreatedInSiigoAt: MoreThanOrEqual(since),
      },
      order: { autoCreatedInSiigoAt: 'DESC' },
    });
  }

  create(
    data: Pick<
      SupplierConfiguration,
      | 'companyId'
      | 'integrationId'
      | 'supplierDocument'
      | 'supplierDocumentType'
      | 'supplierName'
      | 'itemType'
    >,
  ): SupplierConfiguration {
    return this.repository.create(data);
  }

  save(configuration: SupplierConfiguration): Promise<SupplierConfiguration> {
    return this.repository.save(configuration);
  }

  saveMany(
    configurations: SupplierConfiguration[],
  ): Promise<SupplierConfiguration[]> {
    return this.repository.save(configurations);
  }
}
