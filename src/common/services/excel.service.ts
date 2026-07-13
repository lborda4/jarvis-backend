import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

export type ExcelRow = Record<string, unknown>;

@Injectable()
export class ExcelService {
  async readFirstSheet(buffer: Buffer): Promise<ExcelRow[]> {
    const workbook = XLSX.read(Buffer.from(buffer), {
      type: 'buffer',
    });

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

    return XLSX.utils.sheet_to_json<ExcelRow>(firstSheet, {
      defval: '',
    });
  }
}
