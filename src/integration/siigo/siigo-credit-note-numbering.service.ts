import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { normalizeSiigoCredentials } from './helpers/siigo-credentials.helper';
import {
  ensureSiigoCreditNoteNumbering,
  getSiigoCreditNoteNextNumber,
} from './helpers/siigo-credit-note-numbering.helper';
import { SiigoCreditNoteNumbering } from '../interfaces/integration-credentials.interface';

@Injectable()
export class SiigoCreditNoteNumberingService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
  ) {}

  async getOrEnsureNumbering(
    companyId: string,
  ): Promise<SiigoCreditNoteNumbering> {
    const integration = await this.requireSiigoIntegration(companyId);
    const credentials = normalizeSiigoCredentials(integration.credentials);
    const numbering = ensureSiigoCreditNoteNumbering(credentials);

    if (!credentials.credit_note) {
      integration.credentials = {
        ...credentials,
        credit_note: numbering,
      };
      await this.integrationsRepository.save(integration);
    }

    return numbering;
  }

  async allocateNumber(companyId: string): Promise<{
    prefix: string;
    number: number;
    formNumber: null;
  }> {
    const numbering = await this.getOrEnsureNumbering(companyId);
    const number = getSiigoCreditNoteNextNumber(numbering);

    if (number == null) {
      throw new BadRequestException(
        'Se agotó el rango de numeración de nota crédito.',
      );
    }

    return {
      prefix: numbering.prefix,
      number,
      formNumber: null,
    };
  }

  async commitNumber(companyId: string, usedNumber: number): Promise<void> {
    const trimmedCompanyId = companyId?.trim();
    if (!trimmedCompanyId || !Number.isSafeInteger(usedNumber) || usedNumber < 1) {
      return;
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.SIIGO,
      );
    if (!integration) {
      return;
    }

    const credentials = normalizeSiigoCredentials(integration.credentials);
    const current = ensureSiigoCreditNoteNumbering(credentials);
    integration.credentials = {
      ...credentials,
      credit_note: {
        ...current,
        nextConsecutive: usedNumber + 1,
      },
    };
    await this.integrationsRepository.save(integration);
  }

  private async requireSiigoIntegration(companyId: string) {
    const trimmedCompanyId = companyId?.trim();
    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.SIIGO,
      );

    if (!integration) {
      throw new NotFoundException(
        'La empresa activa no tiene integración SIIGO configurada.',
      );
    }

    return integration;
  }
}
