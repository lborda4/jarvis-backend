import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { BoldTerminalsService } from './bold-terminals.service';
import { BoldCashRegistersService } from './bold-cash-registers.service';
import { BoldHttpClient } from './clients/bold-http.client';

describe('Bold terminals and register mapping', () => {
  const response = {
    payload: {
      available_terminals: [
        {
          terminal_serial: 'serial-1',
          name: 'Caja 1',
          status: 'BINDED',
          terminal_model: 'D20',
        },
      ],
    },
    errors: [],
  };
  const client = { getBindedTerminals: jest.fn() };
  const integrations = { findByCompanyAndProvider: jest.fn() };
  const service = new BoldTerminalsService(
    client as never,
    integrations as never,
  );
  beforeEach(() => jest.resetAllMocks());

  it('uses only the saved identity key for the requested company', async () => {
    integrations.findByCompanyAndProvider.mockResolvedValue({
      credentials: { identity_key: ' saved-key ', secret_key: 'secret' },
    });
    client.getBindedTerminals.mockResolvedValue(response);
    expect(await service.getBindedTerminals('company-1')).toBe(response);
    expect(integrations.findByCompanyAndProvider).toHaveBeenCalledWith(
      'company-1',
      'BOLD',
    );
    expect(client.getBindedTerminals).toHaveBeenCalledWith('saved-key');
  });

  it('rejects missing integration instead of returning sample terminals', async () => {
    integrations.findByCompanyAndProvider.mockResolvedValue(null);
    await expect(service.getBindedTerminals('company-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(client.getBindedTerminals).not.toHaveBeenCalled();
  });

  it('rejects missing identity key', async () => {
    integrations.findByCompanyAndProvider.mockResolvedValue({
      credentials: {},
    });
    await expect(service.getBindedTerminals('company-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(client.getBindedTerminals).not.toHaveBeenCalled();
  });

  it('requires a company before looking up credentials', async () => {
    await expect(service.getBindedTerminals('')).rejects.toThrow(
      BadRequestException,
    );
    expect(integrations.findByCompanyAndProvider).not.toHaveBeenCalled();
  });

  it('calls the real endpoint without requiring a global API key', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ status: 200, data: response })),
    };
    const config = {
      get: jest.fn().mockReturnValue({ baseUrl: '', apiKey: '' }),
    };
    const httpClient = new BoldHttpClient(http as never, config as never);
    expect(await httpClient.getBindedTerminals('saved-key')).toBe(response);
    expect(http.get).toHaveBeenCalledWith(
      'https://integrations.api.bold.co/payments/binded-terminals',
      expect.objectContaining({
        headers: { Authorization: 'x-api-key saved-key' },
      }),
    );
  });

  it('rejects Bold errors even on HTTP 200', async () => {
    const http = {
      get: jest
        .fn()
        .mockReturnValue(
          of({
            status: 200,
            data: {
              payload: { available_terminals: [] },
              errors: ['unauthorized'],
            },
          }),
        ),
    };
    const httpClient = new BoldHttpClient(
      http as never,
      { get: () => ({ baseUrl: '' }) } as never,
    );
    await expect(httpClient.getBindedTerminals('saved-key')).rejects.toThrow(
      'lista',
    );
  });

  it('saves the terminal serial with the company and register', async () => {
    const terminals = {
      getBindedTerminals: jest.fn().mockResolvedValue(response),
    };
    const repository = {
      upsert: jest
        .fn()
        .mockImplementation((data) => ({ id: 'mapping-1', ...data })),
    };
    const registers = new BoldCashRegistersService(
      terminals as never,
      repository as never,
    );
    const request = {
      companyId: 'company-1',
      branchOfficeId: 1,
      cashRegisterId: 'register-1',
      cashRegisterName: 'Principal',
      boldTerminalId: 'serial-1',
    };
    expect(await registers.upsert(request)).toEqual({
      id: 'mapping-1',
      branchOfficeId: 1,
      cashRegisterId: 'register-1',
      cashRegisterName: 'Principal',
      boldTerminalId: 'serial-1',
    });
    expect(terminals.getBindedTerminals).toHaveBeenCalledWith('company-1');
    expect(repository.upsert).toHaveBeenCalledWith(request);
  });

  it('rejects a terminal belonging to another company', async () => {
    const terminals = {
      getBindedTerminals: jest.fn().mockResolvedValue(response),
    };
    const repository = { upsert: jest.fn() };
    const registers = new BoldCashRegistersService(
      terminals as never,
      repository as never,
    );
    await expect(
      registers.upsert({
        companyId: 'company-2',
        branchOfficeId: 1,
        cashRegisterId: '1',
        cashRegisterName: 'Caja',
        boldTerminalId: 'other-company-serial',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });
});
