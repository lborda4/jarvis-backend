import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenRouterHttpClient } from './clients/openrouter-http.client';
import { AiGenerationLog } from './entities/ai-generation-log.entity';
import { AiGenerationLogsRepository } from './repositories/ai-generation-logs.repository';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([AiGenerationLog])],
  providers: [OpenRouterHttpClient, AiGenerationLogsRepository],
  exports: [OpenRouterHttpClient],
})
export class OpenRouterModule {}
