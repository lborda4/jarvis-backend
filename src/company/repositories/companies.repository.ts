import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity';

@Injectable()
export class CompaniesRepository {
  constructor(
    @InjectRepository(Company)
    private readonly repository: Repository<Company>,
  ) {}

  findById(id: string): Promise<Company | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByNit(nit: string): Promise<Company | null> {
    return this.repository.findOne({ where: { nit } });
  }

  async findFirst(): Promise<Company | null> {
    const companies = await this.repository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });

    return companies[0] ?? null;
  }

  create(data: Pick<Company, 'nit' | 'name'>): Company {
    return this.repository.create(data);
  }

  save(company: Company): Promise<Company> {
    return this.repository.save(company);
  }

  findLinkedWithIntegrations(userId: string): Promise<Company[]> {
    return this.repository
      .createQueryBuilder('company')
      .innerJoin('company.userCompanies', 'userCompany')
      .leftJoinAndSelect('company.integrations', 'integration')
      .leftJoinAndSelect('integration.plan', 'plan')
      .where('userCompany.userId = :userId', { userId })
      .orderBy('company.createdAt', 'DESC')
      .getMany();
  }

  findAllWithIntegrations(): Promise<Company[]> {
    return this.repository.find({
      relations: {
        integrations: {
          plan: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }
}
