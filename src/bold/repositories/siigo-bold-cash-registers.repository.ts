import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiigoBoldCashRegister } from '../entities/siigo-bold-cash-register.entity';

@Injectable()
export class SiigoBoldCashRegistersRepository {
  constructor(
    @InjectRepository(SiigoBoldCashRegister)
    private readonly repository: Repository<SiigoBoldCashRegister>,
  ) {}

  findByCompany(companyId: string): Promise<SiigoBoldCashRegister[]> {
    return this.repository.find({ where: { companyId } });
  }

  findOneByKey(
    companyId: string,
    branchOfficeId: number,
    cashRegisterId: string,
  ): Promise<SiigoBoldCashRegister | null> {
    return this.repository.findOne({
      where: { companyId, branchOfficeId, cashRegisterId },
    });
  }

  /** Edita por ID interno o vincula una caja por su nombre dentro de la empresa. */
  async upsert(data: {
    companyId: string;
    id?: string;
    branchOfficeId?: number;
    cashRegisterId?: string;
    cashRegisterName: string;
    boldTerminalId: string;
  }): Promise<SiigoBoldCashRegister> {
    const existing = data.id
      ? await this.repository.findOne({
          where: { id: data.id, companyId: data.companyId },
        })
      : data.branchOfficeId != null && data.cashRegisterId
        ? await this.findOneByKey(
            data.companyId,
            data.branchOfficeId,
            data.cashRegisterId,
          )
        : await this.repository.findOne({
            where: {
              companyId: data.companyId,
              cashRegisterName: data.cashRegisterName,
            },
          });
    if (data.id && !existing) {
      throw new NotFoundException('No se encontró la caja para esta empresa.');
    }
    const { id: _id, ...values } = data;

    const entity = this.repository.create({
      branchOfficeId: null,
      cashRegisterId: null,
      ...existing,
      ...values,
    });

    return this.repository.save(entity);
  }
}
