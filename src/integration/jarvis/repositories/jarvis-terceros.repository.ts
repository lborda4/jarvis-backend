import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { JarvisTercero } from '../entities/jarvis-tercero.entity';

@Injectable()
export class JarvisTercerosRepository {
  constructor(
    @InjectRepository(JarvisTercero)
    private readonly repository: Repository<JarvisTercero>,
  ) {}

  findByCompany(companyId: string, search?: string): Promise<JarvisTercero[]> {
    const trimmedSearch = search?.trim();

    if (!trimmedSearch) {
      return this.repository.find({
        where: { companyId },
        order: { name: 'ASC', createdAt: 'DESC' },
      });
    }

    return this.repository.find({
      where: [
        { companyId, name: ILike(`%${trimmedSearch}%`) },
        { companyId, documentNumber: ILike(`%${trimmedSearch}%`) },
      ],
      order: { name: 'ASC', createdAt: 'DESC' },
    });
  }

  findByCompanyAndDocument(
    companyId: string,
    documentType: string,
    documentNumber: string,
  ): Promise<JarvisTercero | null> {
    return this.repository.findOne({
      where: { companyId, documentType, documentNumber },
    });
  }

  create(
    data: Pick<
      JarvisTercero,
      | 'companyId'
      | 'integrationId'
      | 'documentType'
      | 'documentNumber'
      | 'checkDigit'
      | 'name'
      | 'entityType'
      | 'taxRegime'
      | 'email'
      | 'phone'
      | 'address'
    >,
  ): JarvisTercero {
    return this.repository.create(data);
  }

  save(tercero: JarvisTercero): Promise<JarvisTercero> {
    return this.repository.save(tercero);
  }
}
