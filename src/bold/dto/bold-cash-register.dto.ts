import { ApiProperty } from '@nestjs/swagger';

export class BoldCashRegisterDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  branchOfficeId: number;

  @ApiProperty()
  cashRegisterId: string;

  @ApiProperty()
  cashRegisterName: string;

  @ApiProperty()
  boldTerminalId: string;
}

export class ListBoldCashRegistersResponseDto {
  @ApiProperty({ type: [BoldCashRegisterDto] })
  items: BoldCashRegisterDto[];
}

export class UpsertBoldCashRegisterRequestDto {
  @ApiProperty()
  companyId: string;

  @ApiProperty({
    description: 'Sucursal (branch_office) de SIIGO a la que pertenece la caja.',
  })
  branchOfficeId: number;

  @ApiProperty({ description: 'Identificador de la caja en SIIGO POS.' })
  cashRegisterId: string;

  @ApiProperty({ example: 'Caja 1' })
  cashRegisterName: string;

  @ApiProperty({
    description: 'terminal_serial del datáfono Bold (ver GET /payments/binded-terminals).',
  })
  boldTerminalId: string;
}

export class UpsertBoldCashRegisterResponseDto {
  @ApiProperty({ type: BoldCashRegisterDto })
  item: BoldCashRegisterDto;
}
