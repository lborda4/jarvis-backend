import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity';
import { CompaniesRepository } from './repositories/companies.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [CompaniesRepository],
  exports: [CompaniesRepository, TypeOrmModule],
})
export class CompanyModule {}
