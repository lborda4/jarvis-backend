import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SupplierConfiguration } from '../../integration/entities/supplier-configuration.entity';
import { UserCompany } from '../../auth/entities/user-company.entity';
import { Integration } from '../../integration/entities/integration.entity';
import { CompanyPersonType } from '../enums/company-person-type.enum';
import type { CompanyResponsible } from '../interfaces/company-responsible.interface';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  nit: string;

  @Column()
  name: string;

  @Column({
    name: 'person_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  personType: CompanyPersonType | null;

  @Column({ type: 'jsonb', nullable: true })
  responsible: CompanyResponsible | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(
    () => SupplierConfiguration,
    (configuration) => configuration.company,
  )
  supplierConfigurations: SupplierConfiguration[];

  @OneToMany(() => UserCompany, (userCompany) => userCompany.company)
  userCompanies: UserCompany[];

  @OneToMany(() => Integration, (integration) => integration.company)
  integrations: Integration[];
}
