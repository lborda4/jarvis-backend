import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration.module';
import { JarvisController } from './jarvis.controller';
import { JarvisSetupService } from './jarvis-setup.service';

@Module({
  imports: [IntegrationModule],
  controllers: [JarvisController],
  providers: [JarvisSetupService],
  exports: [JarvisSetupService],
})
export class JarvisModule {}
