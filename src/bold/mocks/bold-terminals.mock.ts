import { BoldBindedTerminalsResponseDto } from '../dto/bold-terminals.dto';

/** Mismo mock que compartió Bold para este endpoint — se usa mientras no
 * tengamos credenciales reales configuradas (BOLD_API_KEY/BOLD_API_BASE_URL),
 * ver BoldTerminalsService.getBindedTerminals. */
export const BOLD_BINDED_TERMINALS_MOCK: BoldBindedTerminalsResponseDto = {
  payload: {
    available_terminals: [
      {
        terminal_model: 'N86',
        terminal_serial: 'N860W000000',
        status: 'BINDED',
        name: 'SPRO0000',
      },
      {
        terminal_model: 'N86',
        terminal_serial: 'N860W000001',
        status: 'BINDED',
        name: 'SPRO0001',
      },
    ],
  },
  errors: [],
};
