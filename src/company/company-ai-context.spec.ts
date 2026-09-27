import {
  readCompanyAiContext,
  validateCompanyAiContext,
  companyDescriptionForPrompt,
} from './company-ai-context';
describe('company AI context', () => {
  it('preserves legacy descriptions', () => {
    expect(readCompanyAiContext('Jardín infantil')).toEqual({
      description: 'Jardín infantil',
      rules: [],
    });
  });
  it('accepts and trims ten rules', () => {
    expect(
      validateCompanyAiContext({
        description: ' Jardín ',
        rules: Array(10).fill(' regla '),
      }).rules,
    ).toEqual(Array(10).fill('regla'));
  });
  it.each(
    [Array(11).fill('regla'), [' '], [123], ['x'.repeat(501)], null].map(
      (rules) => ({ rules }),
    ),
  )('rejects invalid rules %j', ({ rules }) => {
    expect(() =>
      validateCompanyAiContext({ description: 'Jardín', rules }),
    ).toThrow();
  });
  it('includes rules only for purchase prompts', () => {
    const context = {
      description: 'Jardín infantil',
      rules: ['Alimentos para almuerzos: 61600502'],
    };
    expect(companyDescriptionForPrompt(context, true)).toContain(
      '1. Alimentos para almuerzos: 61600502',
    );
    expect(companyDescriptionForPrompt(context, false)).toBe('Jardín infantil');
  });
});

it('validates and preserves company blocked accounts', () => {
  const context = validateCompanyAiContext({
    description: 'Empresa',
    rules: [],
    blockedAccounts: [' A-123 ', ' cuenta temporal '],
  });
  expect(readCompanyAiContext(context).blockedAccounts).toEqual([
    'A-123',
    'cuenta temporal',
  ]);
  for (const blockedAccounts of [
    null,
    [''],
    [123],
    Array(101).fill('A'),
    ['x'.repeat(201)],
  ]) {
    expect(() =>
      validateCompanyAiContext({ description: '', rules: [], blockedAccounts }),
    ).toThrow();
  }
});
