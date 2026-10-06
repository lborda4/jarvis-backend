import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import type { BoldCredentials } from '../integration/interfaces/integration-credentials.interface';
import { SiigoBoldCashRegistersRepository } from './repositories/siigo-bold-cash-registers.repository';
import { BoldHttpClient } from './clients/bold-http.client';
import { BoldCheckoutPayload } from './dto/bold-checkout.dto';
import { parseBoldExtensionPayment } from './helpers/bold-extension-payment.helper';

/** Vendedor único de esta primera integración Bold. */
export const BOLD_SELLER_EMAIL = 'acuaticavallesas@gmail.com';

@Injectable()
export class BoldCheckoutService {
  constructor(
    private readonly registers: SiigoBoldCashRegistersRepository,
    private readonly integrations: IntegrationsRepository,
    private readonly client: BoldHttpClient,
  ) {}

  async createFromExtension(body: unknown) {
    const { caja, total } = parseBoldExtensionPayment(body);
    const matches = await this.registers.findByExtensionCaja(caja);
    if (matches.length !== 1) {
      throw new BadRequestException(matches.length ? 'El nombre de caja es ambiguo; hay más de una asociación.' : 'No existe una caja con ese nombre asociada a un datáfono.');
    }
    return this.create(matches[0].companyId, {
      cashRegisterName: matches[0].cashRegisterName,
      userEmail: BOLD_SELLER_EMAIL,
      amount: { currency: 'COP', taxes: [], tip_amount: 0, total_amount: total },
    });
  }

  // companyId debe provenir del contexto autorizado de la solicitud.
  async create(companyId: string, request: {
    cashRegisterName: string;
    userEmail: string;
    amount: BoldCheckoutPayload['amount'];
  }) {
    const name = request.cashRegisterName?.trim();
    if (!companyId?.trim() || !name) throw new BadRequestException('La empresa y el nombre de la caja son obligatorios.');
    if (!request.userEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.userEmail.trim())) {
      throw new BadRequestException('El correo del vendedor no es válido.');
    }
    const amount = request.amount;
    if (!amount || amount.currency !== 'COP' || !Number.isFinite(amount.total_amount) || amount.total_amount <= 0 ||
        !Number.isFinite(amount.tip_amount) || amount.tip_amount < 0 || amount.tip_amount > amount.total_amount || !Array.isArray(amount.taxes)) {
      throw new BadRequestException('El monto del cobro no es válido.');
    }
    const matches = await this.registers.findByCompanyAndName(companyId, name);
    if (matches.length !== 1) {
      throw new BadRequestException(matches.length ? 'Hay varias cajas con ese nombre; debe identificar una única caja.' : 'No hay un datáfono asociado a esa caja en la empresa.');
    }
    const integration = await this.integrations.findByCompanyAndProvider(companyId, IntegrationProvider.BOLD);
    const key = (integration?.credentials as BoldCredentials | undefined)?.identity_key?.trim();
    if (!key) throw new BadRequestException('La empresa no tiene una llave Bold configurada.');
    const terminals = await this.client.getBindedTerminals(key);
    const terminal = terminals.payload.available_terminals.find(t => t.terminal_serial === matches[0].boldTerminalId && t.status === 'BINDED');
    if (!terminal?.terminal_model) throw new BadRequestException('El datáfono asociado no está vinculado a esta cuenta Bold o no tiene modelo.');
    const reference = randomUUID();
    const payload: BoldCheckoutPayload = {
      amount: {
        currency: amount.currency,
        taxes: amount.taxes,
        tip_amount: amount.tip_amount,
        total_amount: amount.total_amount,
      },
      payment_method: 'POS',
      terminal_model: terminal.terminal_model,
      terminal_serial: terminal.terminal_serial,
      reference,
      user_email: request.userEmail.trim(),
    };
    console.log('[Bold] ANTES POST /payments/app-checkout', JSON.stringify(payload, null, 2));
    try {
      //const response = await this.client.createCheckout(key, payload);
      console.log('[Bold] DESPUÉS POST /payments/app-checkout')//, JSON.stringify(response, null, 2));
      return { reference, payload };
    } catch (error) {
      console.log(
        '[Bold] DESPUÉS POST /payments/app-checkout (error)',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
