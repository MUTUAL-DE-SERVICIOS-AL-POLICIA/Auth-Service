/// <reference types="jest" />
import { resolveWebAuthorizationOperation } from './web-authorization-operations';

describe('web authorization operation allowlist', () => {
  it('resolves only the approved beneficiary persons read operation', () => {
    const target = resolveWebAuthorizationOperation('beneficiary.persons.read');
    expect(target).toEqual({
      tool: 'beneficiary',
      resource: 'persons',
      scope: 'read',
    });
    expect(Object.isFrozen(target)).toBe(true);
  });

  it.each([undefined, null, '', 'persons#read', 'beneficiary.persons.write'])(
    'does not resolve an unapproved operation',
    (operation) => {
      expect(resolveWebAuthorizationOperation(operation)).toBeUndefined();
    },
  );
});
