import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { buildEnvFilePaths } from './env-file.util';
import { validateEnvironmentConfiguration } from './env.validation';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: buildEnvFilePaths(),
      load: [configuration],
      validate: validateEnvironmentConfiguration,
    }),
  ],
})
export class AppConfigModule {}
