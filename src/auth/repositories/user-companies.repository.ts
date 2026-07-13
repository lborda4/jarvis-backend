import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserCompany } from '../entities/user-company.entity';

@Injectable()
export class UserCompaniesRepository {
  constructor(
    @InjectRepository(UserCompany)
    private readonly repository: Repository<UserCompany>,
  ) {}

  findActiveCompanyByUserId(userId: string): Promise<UserCompany | null> {
    return this.repository.findOne({
      where: { userId },
      relations: { company: true },
      order: { createdAt: 'ASC' },
    });
  }

  findByUserIdAndCompanyId(
    userId: string,
    companyId: string,
  ): Promise<UserCompany | null> {
    return this.repository.findOne({
      where: { userId, companyId },
      relations: { company: true },
    });
  }

  create(data: Pick<UserCompany, 'userId' | 'companyId'>): UserCompany {
    return this.repository.create(data);
  }

  save(userCompany: UserCompany): Promise<UserCompany> {
    return this.repository.save(userCompany);
  }
}
