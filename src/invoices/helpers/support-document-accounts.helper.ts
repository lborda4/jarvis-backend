import { BadRequestException } from '@nestjs/common';
import { GroupedSupportDocument } from '../../electronic-document/interfaces/support-document-import.interface';

export function resolveExcelAccount(value: string, accounts: Array<{ code: string; name: string }>) {
  const code = value.trim().split(/\s+-\s+/, 1)[0];
  return accounts.find((account) => account.code === code);
}

export function applySupportDocumentExcelAccounts(groups: GroupedSupportDocument[], accounts: Array<{ code: string; name: string }>): void {
  // Validar todo antes de modificar grupos o persistir documentos.
  const mappings = groups.flatMap((group) => group.rows.map((row, index) => {
    if (!row.account?.trim()) return { row, account: undefined };
    const account = resolveExcelAccount(row.account, accounts);
    if (!account) throw new BadRequestException(`La cuenta contable "${row.account}" del ítem ${index + 1} de ${group.documentPrefix}${group.documentNumber} no existe en el catálogo SIIGO de esta empresa.`);
    return { row, account };
  }));
  mappings.forEach(({ row, account }) => {
    if (account) row.accountMapping = { code: account.code, description: account.name };
  });
}
