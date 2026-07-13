import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { getTypeOrmConfig } from './config/typeorm.config';
import { CompanyModule } from './company/company.module';
import { ElectronicDocumentModule } from './electronic-document/electronic-document.module';
import { DianModule } from './dian/dian.module';
import { ImportSessionModule } from './import-session/import-session.module';
import { IntegrationModule } from './integration/integration.module';
import { SiigoModule } from './integration/siigo/siigo.module';
import { InvoicesModule } from './invoices/invoices.module';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmConfig()),
    AuthModule,
    ImportSessionModule,
    IntegrationModule,
    CompanyModule,
    ElectronicDocumentModule,
    InvoicesModule,
    DianModule,
    SiigoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
