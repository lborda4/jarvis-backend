import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AppConfigModule } from '../config/app-config.module';
import { CompanyModule } from '../company/company.module';
import { DianController } from './dian.controller';
import { DianParserService } from './dian-parser.service';
import { DianService } from './dian.service';

@Module({
  imports: [HttpModule, AppConfigModule, CompanyModule],
  controllers: [DianController],
  providers: [DianService, DianParserService],
  exports: [DianService, DianParserService],
})
export class DianModule {}
