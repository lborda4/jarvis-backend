import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Query,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from '../admin/guards/admin.guard';
import { BoldCashRegistersService } from './bold-cash-registers.service';
import { BoldPaymentsService } from './bold-payments.service';
import { BoldTerminalsService } from './bold-terminals.service';
import { BoldWebhookService } from './bold-webhook.service';
import {
  BoldCashRegisterDto,
  ListBoldCashRegistersResponseDto,
  UpsertBoldCashRegisterRequestDto,
  UpsertBoldCashRegisterResponseDto,
} from './dto/bold-cash-register.dto';
import { BoldPaymentMethodsResponseDto } from './dto/bold-payment-methods.dto';
import { BoldBindedTerminalsResponseDto } from './dto/bold-terminals.dto';
import { BoldCheckoutService } from './bold-checkout.service';

@Controller('bold')
export class BoldController {
  private readonly logger = new Logger(BoldController.name);

  constructor(
    private readonly boldPaymentsService: BoldPaymentsService,
    private readonly boldTerminalsService: BoldTerminalsService,
    private readonly boldCashRegistersService: BoldCashRegistersService,
    private readonly boldCheckoutService: BoldCheckoutService,
    private readonly boldWebhookService: BoldWebhookService,
  ) {}

  @Get('payments/payment-methods')
  getPaymentMethods(): Promise<BoldPaymentMethodsResponseDto> {
    return this.boldPaymentsService.getPaymentMethods();
  }

  /** Consulta Bold con la llave guardada de la empresa. */
  @UseGuards(AdminGuard)
  @Get('payments/binded-terminals')
  getBindedTerminals(
    @Query('companyId') companyId: string,
  ): Promise<BoldBindedTerminalsResponseDto> {
    return this.boldTerminalsService.getBindedTerminals(companyId);
  }

  /** Cajas SIIGO ya mapeadas a un datáfono Bold para esta empresa — mismos
   * registros que después consumirá la extensión de Chrome, ver
   * SiigoBoldCashRegister. */
  @UseGuards(AdminGuard)
  @Get('cash-registers/:companyId')
  async listCashRegisters(
    @Param('companyId') companyId: string,
  ): Promise<ListBoldCashRegistersResponseDto> {
    const items = await this.boldCashRegistersService.listByCompany(companyId);

    return { items };
  }

  /** Crea o actualiza (por sucursal + id de caja) el mapeo caja↔datáfono —
   * el admin la llena a mano desde el panel; la extensión de Chrome hará lo
   * mismo automáticamente más adelante, sobre la misma tabla. */
  @UseGuards(AdminGuard)
  @Post('cash-registers')
  async upsertCashRegister(
    @Body() request: UpsertBoldCashRegisterRequestDto,
  ): Promise<UpsertBoldCashRegisterResponseDto> {
    const item: BoldCashRegisterDto =
      await this.boldCashRegistersService.upsert(request);

    return { item };
  }

  /**
   * Webhook de producción. Registrar en Panel Comercios → Integraciones
   * → Webhooks. Firma con la llave secreta. Responde 200 enseguida
   * (Bold espera máximo 2s; si no, reintenta hasta 5 veces).
   */
  @Public()
  @Post('webhooks')
  @HttpCode(HttpStatus.OK)
  receiveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-bold-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.boldWebhookService.receiveProduction({
      rawBody: request.rawBody,
      signature,
      body,
    });
  }

  /**
   * Webhook de pruebas de Bold (firma con llave vacía). Registrar en
   * Panel Comercios → Integraciones → Webhooks → webhooks de prueba.
   */
  @Public()
  @Post('webhooks/test')
  @HttpCode(HttpStatus.OK)
  receiveTestWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-bold-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.boldWebhookService.receiveTest({
      rawBody: request.rawBody,
      signature,
      body,
    });
  }

  /** Recepción pública de la extensión para la primera empresa integrada.
   * Conserva la ruta existente; ahora solicita el cobro al datáfono Bold. */
  @Public()
  @Post('jarvis/test')
  async testJarvis(@Body() body: unknown) {
    this.logger.log(`JSON recibido de la extensión: ${JSON.stringify(body)}`);
    try {
      const result = await this.boldCheckoutService.createFromExtension(body);
      return {
        success: true,
        message: 'Solicitud de cobro enviada a Bold.',
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof HttpException
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.warn(`POST /bold/jarvis/test falló: ${message}`);
      throw error;
    }
  }
}
