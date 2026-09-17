import { Injectable } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { JarvisTax } from '../entities/jarvis-tax.entity';
import { JarvisTaxCategory } from '../enums/jarvis-tax-category.enum';

export interface FindJarvisTaxesFilters {
  category?: JarvisTaxCategory;
  search?: string;
  isActive?: boolean;
}

@Injectable()
export class JarvisTaxesRepository {
  constructor(
    @InjectRepository(JarvisTax)
    private readonly repository: Repository<JarvisTax>,
  ) {}

  findByCompany(
    companyId: string,
    filters: FindJarvisTaxesFilters = {},
  ): Promise<JarvisTax[]> {
    const query = this.repository
      .createQueryBuilder('tax')
      .where('tax.companyId = :companyId', { companyId });

    if (filters.category) {
      query.andWhere('tax.category = :category', {
        category: filters.category,
      });
    }

    if (filters.isActive != null) {
      query.andWhere('tax.isActive = :isActive', {
        isActive: filters.isActive,
      });
    }

    const trimmedSearch = filters.search?.trim();
    if (trimmedSearch) {
      query.andWhere(
        '(tax.code ILIKE :search OR tax.name ILIKE :search)',
        { search: `%${trimmedSearch}%` },
      );
    }

    return query
      .orderBy('tax.code', 'ASC')
      .addOrderBy('tax.createdAt', 'ASC')
      .getMany();
  }

  findById(id: string, companyId: string): Promise<JarvisTax | null> {
    return this.repository.findOne({ where: { id, companyId } });
  }

  /** Usado al crear/editar un producto: valida que los ids elegidos existan
   * y sean de ESTA empresa antes de asociarlos (ver ProductsService). */
  findByIdsAndCompany(ids: string[], companyId: string): Promise<JarvisTax[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.repository.find({ where: { id: In(ids), companyId } });
  }

  findByCompanyAndCode(
    companyId: string,
    code: string,
  ): Promise<JarvisTax | null> {
    return this.repository.findOne({ where: { companyId, code } });
  }

  /**
   * El código ya no lo elige el usuario (pedido explícito: "el código va a
   * ser una numeración interna... nosotros vamos a crear el id") — se
   * autogenera acá como el siguiente entero disponible para la empresa,
   * sea cual sea la categoría (impuestos y retenciones comparten la misma
   * secuencia porque comparten la misma columna `code`, única por
   * empresa). Códigos no numéricos que hubiera de antes (por datos
   * cargados a mano) se ignoran para este cálculo en vez de romperlo.
   */
  async findNextAvailableCode(companyId: string): Promise<string> {
    const taxes = await this.repository.find({
      where: { companyId },
      select: { code: true },
    });

    const maxCode = taxes.reduce((max, tax) => {
      const parsed = Number.parseInt(tax.code, 10);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);

    return String(maxCode + 1);
  }

  findByCompanyAndCodeExcludingId(
    companyId: string,
    code: string,
    excludeId: string,
  ): Promise<JarvisTax | null> {
    return this.repository
      .createQueryBuilder('tax')
      .where('tax.companyId = :companyId', { companyId })
      .andWhere('tax.code = :code', { code })
      .andWhere('tax.id != :excludeId', { excludeId })
      .getOne();
  }

  create(
    data: Pick<
      JarvisTax,
      | 'companyId'
      | 'integrationId'
      | 'category'
      | 'code'
      | 'name'
      | 'taxType'
      | 'rate'
      | 'isActive'
    >,
  ): JarvisTax {
    return this.repository.create(data);
  }

  save(tax: JarvisTax): Promise<JarvisTax> {
    return this.repository.save(tax);
  }

  async remove(tax: JarvisTax): Promise<void> {
    await this.repository.remove(tax);
  }
}
