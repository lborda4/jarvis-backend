import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OpenRouterHttpClient } from './clients/openrouter-http.client';

@Module({
  imports: [HttpModule],
  providers: [OpenRouterHttpClient],
  exports: [OpenRouterHttpClient],
})
export class OpenRouterModule {}
