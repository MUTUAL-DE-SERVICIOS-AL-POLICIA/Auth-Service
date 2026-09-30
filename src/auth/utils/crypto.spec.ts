/// <reference types="jest" />
import {
  createBrowserBinding,
  createNonce,
  createPkce,
  createState,
  hashBrowserBinding,
  verifyBrowserBinding,
  codeChallengeS256,
} from './crypto';

describe('web auth crypto', () => {
  it('generates a valid random PKCE pair with fixed S256', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(a.challenge).toBe(codeChallengeS256(a.verifier));
    expect(a.method).toBe('S256');
    expect(a.verifier).not.toBe(b.verifier);
  });
  it('generates independent opaque state, nonce and binding', () => {
    const values = [createState(), createNonce(), createBrowserBinding()];
    expect(new Set(values).size).toBe(3);
    values.forEach((value) => expect(value.length).toBeGreaterThanOrEqual(43));
    expect(verifyBrowserBinding(values[2], hashBrowserBinding(values[2]))).toBe(
      true,
    );
    expect(verifyBrowserBinding('wrong', hashBrowserBinding(values[2]))).toBe(
      false,
    );
  });
});
