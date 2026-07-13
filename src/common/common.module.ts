import { Module } from '@nestjs/common';
import { ExcelService } from './services/excel.service';

@Module({
  providers: [ExcelService],
  exports: [ExcelService],
})
export class CommonModule {}
