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

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  nit: string;

  @Column()
  name: string;

  @Column({ name: 'dian_cookie', type: 'text', nullable: true })
  dianCookie: string | null;

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
