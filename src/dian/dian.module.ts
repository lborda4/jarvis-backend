import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CompanyModule } from '../company/company.module';
import { DianController } from './dian.controller';
import { DianParserService } from './dian-parser.service';
import { DianService } from './dian.service';

@Module({
  imports: [HttpModule, CompanyModule],
  controllers: [DianController],
  providers: [DianService, DianParserService],
  exports: [DianService, DianParserService],
})
export class DianModule {}
