import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureBodyParsers } from './common/body-parsers';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfiguration } from './config/configuration';
import { SocketIoAdapter } from './realtime/socket-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  configureBodyParsers(app);

  const configService = app.get(ConfigService<AppConfiguration, true>);

  const port = configService.get('app.port', { infer: true });
  const corsOrigins = configService.get('app.corsOrigins', { infer: true });

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'rquid',
      'x-bold-signature',
    ],
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useWebSocketAdapter(new SocketIoAdapter(app, corsOrigins));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Backend API')
    .setDescription(
      'API del backend de documentos electrónicos e integración Siigo',
    )
    .setVersion('1.0')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    swaggerConfig,
  );

  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(port);
}

bootstrap();
