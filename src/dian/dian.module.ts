import { Module } from '@nestjs/common';
import { DianParserService } from './dian-parser.service';

@Module({
  providers: [DianParserService],
  exports: [DianParserService],
})
export class DianModule {}
