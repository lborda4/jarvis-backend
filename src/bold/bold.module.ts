import { Module } from '@nestjs/common';
import { BoldController } from './bold.controller';

@Module({
  controllers: [BoldController],
})
export class BoldModule {}
