import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisTaxCategory } from '../enums/jarvis-tax-category.enum';

export class CreateJarvisTaxRequestDto {
  @ApiProperty({ enum: JarvisTaxCategory, example: JarvisTaxCategory.IMPUESTO })
  category: JarvisTaxCategory;

  // Código: NO lo elige el usuario (pedido explícito) — el servicio lo
  // autogenera (ver JarvisTaxesRepository.findNextAvailableCode). Un
  // impuesto siempre nace Activo; is_active solo puede cambiarse después,
  // vía update.

  @ApiProperty({ example: 'IVA Venta 19%' })
  name: string;

  @ApiProperty({ example: 'IVA' })
  tax_type: string;

  @ApiPropertyOptional({
    example: 19,
    nullable: true,
    description:
      'Tarifa (%). Se ignora si tax_type es ReteICA — esa siempre se divide en mil, sin tarifa manual.',
  })
  rate?: number | null;
}

export class UpdateJarvisTaxRequestDto {
  @ApiPropertyOptional({ enum: JarvisTaxCategory })
  category?: JarvisTaxCategory;

  @ApiPropertyOptional({ example: '111' })
  code?: string;

  @ApiPropertyOptional({ example: 'IVA Venta 19%' })
  name?: string;

  @ApiPropertyOptional({ example: 'IVA' })
  tax_type?: string;

  @ApiPropertyOptional({ nullable: true })
  rate?: number | null;

  @ApiPropertyOptional()
  is_active?: boolean;
}

export class JarvisTaxDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: JarvisTaxCategory })
  category: JarvisTaxCategory;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  tax_type: string;

  @ApiPropertyOptional({ nullable: true })
  rate: number | null;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({
    description:
      'Informativo: si algo del sistema ya referencia este impuesto. No editable directamente.',
  })
  is_in_use: boolean;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

export class JarvisTaxesListResponseDto {
  @ApiProperty({ type: [JarvisTaxDto] })
  items: JarvisTaxDto[];

  @ApiProperty()
  total: number;
}

export class CreateJarvisTaxResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: JarvisTaxDto })
  tax: JarvisTaxDto;
}

export class UpdateJarvisTaxResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: JarvisTaxDto })
  tax: JarvisTaxDto;
}

export class DeleteJarvisTaxResponseDto {
  @ApiProperty()
  success: boolean;
}
