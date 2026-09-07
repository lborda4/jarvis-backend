import { Injectable } from '@nestjs/common';
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

  /** Crea el mapeo si no existe, o actualiza nombre/terminal si ya
   * existía — la clave de identidad es (empresa, sucursal, caja). */
  async upsert(data: {
    companyId: string;
    branchOfficeId: number;
    cashRegisterId: string;
    cashRegisterName: string;
    boldTerminalId: string;
  }): Promise<SiigoBoldCashRegister> {
    const existing = await this.findOneByKey(
      data.companyId,
      data.branchOfficeId,
      data.cashRegisterId,
    );

    const entity = this.repository.create({
      ...existing,
      ...data,
    });

    return this.repository.save(entity);
  }
}
