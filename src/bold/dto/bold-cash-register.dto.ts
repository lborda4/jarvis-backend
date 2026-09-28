import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BoldCashRegisterDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  branchOfficeId: number | null;

  @ApiProperty({ nullable: true })
  cashRegisterId: string | null;

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
  @ApiPropertyOptional({
    description: 'Identificador interno al editar una caja existente.',
  })
  id?: string;
  @ApiProperty()
  companyId: string;

  @ApiPropertyOptional()
  branchOfficeId?: number;

  @ApiPropertyOptional()
  cashRegisterId?: string;

  @ApiProperty({ example: 'Caja 1' })
  cashRegisterName: string;

  @ApiProperty({
    description:
      'terminal_serial del datáfono Bold (ver GET /payments/binded-terminals).',
  })
  boldTerminalId: string;
}

export class UpsertBoldCashRegisterResponseDto {
  @ApiProperty({ type: BoldCashRegisterDto })
  item: BoldCashRegisterDto;
}
