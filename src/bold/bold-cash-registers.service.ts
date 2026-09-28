import { BoldTerminalsService } from './bold-terminals.service';
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
    private readonly boldTerminalsService: BoldTerminalsService,
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

    if (
      request.branchOfficeId != null &&
      (!Number.isInteger(branchOfficeId) || branchOfficeId <= 0)
    ) {
      throw new BadRequestException('La sucursal debe ser un número válido.');
    }
    if (!cashRegisterName) {
      throw new BadRequestException('El nombre de la caja es obligatorio.');
    }

    if (!boldTerminalId) {
      throw new BadRequestException('Debe seleccionar un datáfono.');
    }

    const { payload } =
      await this.boldTerminalsService.getBindedTerminals(companyId);
    if (
      !payload.available_terminals.some(
        (terminal) =>
          terminal.terminal_serial === boldTerminalId &&
          terminal.status === 'BINDED',
      )
    ) {
      throw new BadRequestException(
        'El datáfono no está vinculado a la cuenta Bold de esta empresa.',
      );
    }

    const entity = await this.cashRegistersRepository.upsert({
      ...(request.id ? { id: request.id } : {}),
      companyId,
      ...(request.branchOfficeId != null ? { branchOfficeId } : {}),
      ...(cashRegisterId ? { cashRegisterId } : {}),
      cashRegisterName,
      boldTerminalId,
    });

    return mapToDto(entity);
  }
}
