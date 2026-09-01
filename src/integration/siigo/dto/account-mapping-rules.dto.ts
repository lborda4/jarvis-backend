export class AccountMappingRuleItemDto {
  descripcion: string;
  accountCode: string;
  accountName: string | null;
  /** Cuántas veces se aplicó esta regla — uso automático incluido, no solo
   * confirmación manual (ver SupplierItemAccountMapping.confirmationsCount). */
  confirmationsCount: number;
  lastConfirmedAt: string | null;
}

export class AccountMappingRuleSupplierDto {
  supplierDocument: string;
  supplierName: string | null;
  /** true si todas las descripciones de este proveedor apuntan a la misma
   * cuenta — el front muestra una sola línea resumida en vez de listar
   * cada ítem. */
  isSingleAccount: boolean;
  singleAccount?: { code: string; name: string | null };
  items: AccountMappingRuleItemDto[];
}

export class ListAccountMappingRulesResponseDto {
  suppliers: AccountMappingRuleSupplierDto[];
}

export class UpdateAccountMappingRuleRequestDto {
  supplierDocument: string;
  descripcion: string;
  accountCode: string;
  accountName?: string;
}

export class UpdateAccountMappingRuleResponseDto {
  success: boolean;
  rule: AccountMappingRuleItemDto;
}
