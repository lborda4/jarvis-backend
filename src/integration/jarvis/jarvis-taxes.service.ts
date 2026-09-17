import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateJarvisTaxRequestDto,
  CreateJarvisTaxResponseDto,
  DeleteJarvisTaxResponseDto,
  JarvisTaxDto,
  JarvisTaxesListResponseDto,
  UpdateJarvisTaxRequestDto,
  UpdateJarvisTaxResponseDto,
} from './dto/jarvis-tax.dto';
import { JarvisTax } from './entities/jarvis-tax.entity';
import { JarvisTaxCategory } from './enums/jarvis-tax-category.enum';
import {
  FindJarvisTaxesFilters,
  JarvisTaxesRepository,
} from './repositories/jarvis-taxes.repository';

const VALID_CATEGORIES = new Set<string>(Object.values(JarvisTaxCategory));

/** ReteICA no lleva tarifa manual: por defecto se divide en mil (pedido
 * explícito) — cualquier tarifa que llegue para este tipo se ignora acá
 * (no solo se oculta el campo en el front) para que quede consistente
 * sin importar por dónde entre la petición. */
function isReteIca(taxType: string): boolean {
  return taxType.trim().toLowerCase() === 'reteica';
}

@Injectable()
export class JarvisTaxesService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTaxesRepository: JarvisTaxesRepository,
  ) {}

  async list(
    companyId: string,
    category?: string,
    search?: string,
    isActive?: boolean,
  ): Promise<JarvisTaxesListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const filters: FindJarvisTaxesFilters = {
      search,
      isActive,
    };

    if (category) {
      if (!VALID_CATEGORIES.has(category)) {
        throw new BadRequestException(
          'La categoría debe ser IMPUESTO o RETENCION.',
        );
      }
      filters.category = category as JarvisTaxCategory;
    }

    const items = await this.jarvisTaxesRepository.findByCompany(
      trimmedCompanyId,
      filters,
    );

    return {
      items: items.map((item) => this.toDto(item)),
      total: items.length,
    };
  }

  async create(
    request: CreateJarvisTaxRequestDto,
    companyId: string,
  ): Promise<CreateJarvisTaxResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const integration = await this.requireJarvisIntegration(trimmedCompanyId);

    const category = this.requireValidCategory(request.category);

    const name = request.name?.trim();
    if (!name) {
      throw new BadRequestException('El nombre es obligatorio.');
    }

    const taxType = request.tax_type?.trim();
    if (!taxType) {
      throw new BadRequestException('El tipo de impuesto es obligatorio.');
    }

    const rate = isReteIca(taxType) ? null : this.normalizeRate(request.rate);

    // El código es una numeración interna que asigna el sistema (pedido
    // explícito: el cliente elige solo el nombre, nunca el código) — se
    // reintenta una vez si justo se coló una carrera con otra creación
    // simultánea que ya tomó el código calculado.
    const code = await this.generateUniqueCode(trimmedCompanyId);

    const tax = await this.jarvisTaxesRepository.save(
      this.jarvisTaxesRepository.create({
        companyId: trimmedCompanyId,
        integrationId: integration.id,
        category,
        code,
        name,
        taxType,
        rate,
        // Siempre nace Activo (pedido explícito) — desactivarlo es cosa
        // de un update posterior, no de la creación.
        isActive: true,
      }),
    );

    return { success: true, tax: this.toDto(tax) };
  }

  /** Reintenta UNA vez si la carrera con otra creación simultánea ya tomó
   * el código recién calculado (el índice único de (company_id, code) lo
   * detectaría igual, pero mejor no exponer ese error crudo de Postgres). */
  private async generateUniqueCode(companyId: string): Promise<string> {
    const code = await this.jarvisTaxesRepository.findNextAvailableCode(
      companyId,
    );
    const existing = await this.jarvisTaxesRepository.findByCompanyAndCode(
      companyId,
      code,
    );

    if (!existing) {
      return code;
    }

    return this.jarvisTaxesRepository.findNextAvailableCode(companyId);
  }

  async update(
    id: string,
    request: UpdateJarvisTaxRequestDto,
    companyId: string,
  ): Promise<UpdateJarvisTaxResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const tax = await this.jarvisTaxesRepository.findById(
      id,
      trimmedCompanyId,
    );
    if (!tax) {
      throw new NotFoundException('No se encontró el impuesto.');
    }

    if (request.category !== undefined) {
      tax.category = this.requireValidCategory(request.category);
    }

    if (request.code !== undefined) {
      const code = request.code.trim();
      if (!code) {
        throw new BadRequestException('El código es obligatorio.');
      }

      const existing =
        await this.jarvisTaxesRepository.findByCompanyAndCodeExcludingId(
          trimmedCompanyId,
          code,
          tax.id,
        );
      if (existing) {
        throw new ConflictException('Ya existe un impuesto con ese código.');
      }

      tax.code = code;
    }

    if (request.name !== undefined) {
      const name = request.name.trim();
      if (!name) {
        throw new BadRequestException('El nombre es obligatorio.');
      }
      tax.name = name;
    }

    if (request.tax_type !== undefined) {
      const taxType = request.tax_type.trim();
      if (!taxType) {
        throw new BadRequestException('El tipo de impuesto es obligatorio.');
      }
      tax.taxType = taxType;
    }

    if (request.rate !== undefined) {
      tax.rate = this.normalizeRate(request.rate);
    }

    // Se revisa DESPUÉS de aplicar tax_type/rate (en cualquier orden que
    // hayan llegado en el mismo request) — si el tipo final es ReteICA, la
    // tarifa manual no aplica sin importar lo que se haya mandado.
    if (isReteIca(tax.taxType)) {
      tax.rate = null;
    }

    if (request.is_active !== undefined) {
      tax.isActive = request.is_active;
    }

    const saved = await this.jarvisTaxesRepository.save(tax);

    return { success: true, tax: this.toDto(saved) };
  }

  async remove(
    id: string,
    companyId: string,
  ): Promise<DeleteJarvisTaxResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const tax = await this.jarvisTaxesRepository.findById(
      id,
      trimmedCompanyId,
    );
    if (!tax) {
      throw new NotFoundException('No se encontró el impuesto.');
    }

    await this.jarvisTaxesRepository.remove(tax);

    return { success: true };
  }

  private requireValidCategory(
    category: string | undefined,
  ): JarvisTaxCategory {
    if (!category || !VALID_CATEGORIES.has(category)) {
      throw new BadRequestException(
        'La categoría debe ser IMPUESTO o RETENCION.',
      );
    }
    return category as JarvisTaxCategory;
  }

  /** La tarifa llega como number desde el DTO (JSON no distingue "10" de
   * "10.0"); acá se convierte al string que espera la columna numeric de
   * Postgres/TypeORM, o null si no se envió/se envió vacío. */
  private normalizeRate(rate: number | null | undefined): string | null {
    if (rate === undefined || rate === null) {
      return null;
    }

    if (!Number.isFinite(rate)) {
      throw new BadRequestException('La tarifa debe ser un número válido.');
    }

    return String(rate);
  }

  private requireCompanyId(companyId: string): string {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    return trimmedCompanyId;
  }

  private async requireJarvisIntegration(companyId: string) {
    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        companyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      throw new NotFoundException(
        'La empresa activa no tiene integración Jarvis configurada.',
      );
    }

    return integration;
  }

  private toDto(tax: JarvisTax): JarvisTaxDto {
    return {
      id: tax.id,
      category: tax.category,
      code: tax.code,
      name: tax.name,
      tax_type: tax.taxType,
      rate: tax.rate === null ? null : Number(tax.rate),
      is_active: tax.isActive,
      is_in_use: tax.isInUse,
      created_at: tax.createdAt.toISOString(),
      updated_at: tax.updatedAt.toISOString(),
    };
  }
}
