export class BoldTerminalDto {
  terminal_model: string;
  terminal_serial: string;
  status: string;
  name: string;
}

/** Forma tal cual la devuelve GET /payments/binded-terminals de Bold. */
export class BoldBindedTerminalsResponseDto {
  payload: {
    available_terminals: BoldTerminalDto[];
  };
  errors: unknown[];
}
