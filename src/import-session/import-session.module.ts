import { Global, Module } from '@nestjs/common';
import { ImportSessionService } from './import-session.service';
import { ImportSessionStore } from './import-session.store';

@Global()
@Module({
  providers: [ImportSessionStore, ImportSessionService],
  exports: [ImportSessionService],
})
export class ImportSessionModule {}
