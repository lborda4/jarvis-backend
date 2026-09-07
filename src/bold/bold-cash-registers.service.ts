import { BadRequestException, Injectable } from '@nestjs/common';
import { SiigoBoldCashRegister } from './entities/siigo-bold-cash-register.entity';
import { SiigoBoldCashRegistersRepository } from './repositories/siigo-bold-cash-registers.repository';
import {
  BoldCashRegisterDto,
  UpsertBoldCashRegisterRequestDto,
} from './dto/bold-cash-register.dto';

function mapToDto(entity: SiigoBoldCashRegister): BoldCashRegisterDto {
  return {
    id: entity.id,
    branchOfficeId: entity.branchOfficeId,
    cashRegisterId: entity.cashRegisterId,
    cashRegisterName: entity.cashRegisterName,
    boldTerminalId: entity.boldTerminalId,
  };
}

@Injectable()
export class BoldCashRegistersService {
  constructor(
    private readonly cashRegistersRepository: SiigoBoldCashRegistersRepository,
  ) {}

  async listByCompany(companyId: string): Promise<BoldCashRegisterDto[]> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException('El companyId es obligatorio.');
    }

    const entities =
      await this.cashRegistersRepository.findByCompany(trimmedCompanyId);

    return entities.map(mapToDto);
  }

  async upsert(
    request: UpsertBoldCashRegisterRequestDto,
  ): Promise<BoldCashRegisterDto> {
    const companyId = request?.companyId?.trim();
    const cashRegisterId = request?.cashRegisterId?.trim();
    const cashRegisterName = request?.cashRegisterName?.trim();
    const boldTerminalId = request?.boldTerminalId?.trim();
    const branchOfficeId = Number(request?.branchOfficeId);

    if (!companyId) {
      throw new BadRequestException('El companyId es obligatorio.');
    }

    if (!Number.isFinite(branchOfficeId) || branchOfficeId <= 0) {
      throw new BadRequestException(
        'La sucursal (branchOfficeId) debe ser un número válido.',
      );
    }

    if (!cashRegisterId) {
      throw new BadRequestException('El id de la caja es obligatorio.');
    }

    if (!cashRegisterName) {
      throw new BadRequestException('El nombre de la caja es obligatorio.');
    }

    if (!boldTerminalId) {
      throw new BadRequestException('Debe seleccionar un datáfono.');
    }

    const entity = await this.cashRegistersRepository.upsert({
      companyId,
      branchOfficeId,
      cashRegisterId,
      cashRegisterName,
      boldTerminalId,
    });

    return mapToDto(entity);
  }
}
