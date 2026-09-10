import './polyfills/crypto-global';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { AppConfiguration } from './config/configuration';
import { buildTypeOrmConfig } from './config/typeorm.config';
import { CompanyModule } from './company/company.module';
import { ElectronicDocumentModule } from './electronic-document/electronic-document.module';
import { DianModule } from './dian/dian.module';
import { ImportSessionModule } from './import-session/import-session.module';
import { IntegrationModule } from './integration/integration.module';
import { SiigoModule } from './integration/siigo/siigo.module';
import { JarvisModule } from './integration/jarvis/jarvis.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AdminModule } from './admin/admin.module';
import { BoldModule } from './bold/bold.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfiguration, true>) =>
        buildTypeOrmConfig(configService),
    }),
    AuthModule,
    ImportSessionModule,
    IntegrationModule,
    CompanyModule,
    ElectronicDocumentModule,
    InvoicesModule,
    DianModule,
    SiigoModule,
    JarvisModule,
    AdminModule,
    BoldModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
