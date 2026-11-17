import { Body, Controller, Module, Post, RawBodyRequest, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import request from 'supertest';
import { configureBodyParsers } from './body-parsers';

@Controller()
class ParserTestController {
  @Post('auth/login')
  login(@Body() body: { email?: string; password?: string }) {
    return { hasEmail: Boolean(body?.email), hasPassword: Boolean(body?.password) };
  }

  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>) {
    return { raw: req.rawBody?.toString('utf8'), parsed: req.body };
  }

  @Post('integrations/jarvis/payroll/documents')
  documents(@Body() body: { data: string }) {
    return { length: body.data.length };
  }

  @Post('integrations/jarvis/payroll/periods')
  periods(@Body() body: { data: string }) {
    return { length: body.data.length };
  }
}

@Module({ controllers: [ParserTestController] })
class ParserTestModule {}

describe('lectura JSON de la API con límites especiales de nómina', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ParserTestModule, { rawBody: true, logger: false });
    configureBodyParsers(app);
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('entrega ambos campos del login al controlador', async () => {
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email: 'test@example.com', password: 'synthetic-test-password' })
      .expect(201).expect({ hasEmail: true, hasPassword: true });
  });

  it('conserva los bytes originales y el cuerpo JSON para firmas de webhooks', async () => {
    const raw = '{ "event": "test", "amount": 100 }';
    await request(app.getHttpServer()).post('/webhook').set('Content-Type', 'application/json')
      .send(raw).expect(201).expect({ raw, parsed: { event: 'test', amount: 100 } });
  });

  it('permite lotes de documentos mayores a 1 MB', async () => {
    const data = 'x'.repeat(1100 * 1024);
    await request(app.getHttpServer()).post('/integrations/jarvis/payroll/documents')
      .send({ data }).expect(201).expect({ length: data.length });
  });

  it('permite períodos mayores a 100 KB y mantiene su límite de 1 MB', async () => {
    const data = 'x'.repeat(150 * 1024);
    await request(app.getHttpServer()).post('/integrations/jarvis/payroll/periods')
      .send({ data }).expect(201).expect({ length: data.length });
    await request(app.getHttpServer()).post('/integrations/jarvis/payroll/periods')
      .send({ data: 'x'.repeat(1100 * 1024) }).expect(413);
  });

  it('no aumenta el límite general del login', async () => {
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email: 'test@example.com', password: 'x'.repeat(150 * 1024) }).expect(413);
  });
});
