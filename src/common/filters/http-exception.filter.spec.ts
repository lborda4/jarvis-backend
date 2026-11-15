import { ArgumentsHost, BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('errores HTTP previos al servicio de nómina', () => {
  let errorLog: jest.SpyInstance;
  beforeEach(() => { errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => { errorLog.mockRestore(); });

  function handle(exception: unknown, url: string) {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url }), getResponse: () => response }) } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(exception, host);
    return response;
  }

  it.each([new NotFoundException(), new ForbiddenException(), new BadRequestException()])('registra errores de ruta, permisos y parámetros sin depender de PayrollService', exception => {
    const url = '/integrations/jarvis/payroll/months/2026-12/employees/employee/send';
    const response = handle(exception, url);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`[payroll] HTTP ${exception.getStatus()} POST ${url} message=`));
    expect(response.status).toHaveBeenCalledWith(exception.getStatus());
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: exception.getStatus() }));
  });

  it('omite parámetros de consulta y mantiene el comportamiento de otros módulos', () => {
    handle(new BadRequestException(), '/integrations/jarvis/payroll/documents?token=private-token');
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('[payroll] HTTP 400 POST /integrations/jarvis/payroll/documents message='));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-token');
    errorLog.mockClear();
    handle(new BadRequestException(), '/other-route');
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('muestra el motivo de permisos sin imprimir credenciales Bearer del mensaje', () => {
    handle(new ForbiddenException('La empresa no tiene una integración JARVIS activa. Bearer private-token'), '/integrations/jarvis/payroll/documents/id/send');
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('La empresa no tiene una integración JARVIS activa.'));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-token');
  });
});
