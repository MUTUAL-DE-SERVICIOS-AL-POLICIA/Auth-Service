/// <reference types="jest" />
import {
  UnknownWebToolError,
  ClientCatalogConfigError,
  parseClientCatalog,
  resolveTool,
} from './client-catalog';

const beneficiary = {
  clientId: 'beneficiary-interface',
};
const normalizedBeneficiary = {
  clientId: 'beneficiary-interface',
  audience: 'beneficiary-interface',
  resourceServer: 'beneficiary-interface',
};

function catalogJson(entry: Record<string, unknown> = beneficiary): string {
  return JSON.stringify({ beneficiary: entry });
}

describe('web client catalog', () => {
  it('accepts an empty catalog', () => {
    expect(parseClientCatalog('{}', 'hub-client')).toEqual({});
    expect(parseClientCatalog(undefined, 'hub-client')).toEqual({});
  });

  it('accepts the approved beneficiary entry', () => {
    expect(parseClientCatalog(catalogJson(), 'hub-client')).toEqual({
      beneficiary: normalizedBeneficiary,
    });
  });

  it('rejects malformed JSON and non-object roots', () => {
    for (const value of ['{invalid', '[]', 'null', '"catalog"']) {
      expect(() => parseClientCatalog(value, 'hub-client')).toThrow(
        ClientCatalogConfigError,
      );
    }
  });

  it('rejects additional properties, including sensitive and HTTP metadata', () => {
    for (const property of ['secret', 'origins', 'url']) {
      expect(() =>
        parseClientCatalog(
          catalogJson({ ...beneficiary, [property]: 'forbidden-value' }),
          'hub-client',
        ),
      ).toThrow(ClientCatalogConfigError);
    }
  });

  it('rejects absent, empty and non-normalized fields', () => {
    for (const entry of [
      {},
      { ...beneficiary, clientId: '' },
      { ...beneficiary, clientId: ' beneficiary-interface' },
      { ...beneficiary, clientId: 'beneficiary-interface\u200b' },
    ]) {
      expect(() =>
        parseClientCatalog(catalogJson(entry), 'hub-client'),
      ).toThrow(ClientCatalogConfigError);
    }
  });

  it('rejects invalid and dangerous tool keys', () => {
    for (const toolKey of [
      '',
      'Beneficiary',
      'beneficiary interface',
      '__proto__',
      'prototype',
      'constructor',
    ]) {
      const input = JSON.stringify({ [toolKey]: beneficiary });
      expect(() => parseClientCatalog(input, 'hub-client')).toThrow(
        ClientCatalogConfigError,
      );
    }
  });

  it('rejects the Hub as a secondary context', () => {
    expect(() =>
      parseClientCatalog(catalogJson({ clientId: 'hub-client' }), 'hub-client'),
    ).toThrow(ClientCatalogConfigError);
  });

  it('rejects ambiguous technical identifiers between tools', () => {
    expect(() =>
      parseClientCatalog(
        JSON.stringify({ beneficiary, another: beneficiary }),
        'hub-client',
      ),
    ).toThrow(ClientCatalogConfigError);
  });

  it('resolves only the exact configured tool key', () => {
    const catalog = parseClientCatalog(catalogJson(), 'hub-client');
    expect(resolveTool(catalog, 'beneficiary')).toEqual(normalizedBeneficiary);
    for (const alias of [
      'beneficiary-interface',
      beneficiary.clientId,
      'unknown',
    ]) {
      expect(() => resolveTool(catalog, alias)).toThrow(UnknownWebToolError);
    }
  });

  it('does not expose rejected values in configuration errors', () => {
    const sensitive = 'sensitive-value-that-must-not-be-echoed';
    try {
      parseClientCatalog(
        catalogJson({ ...beneficiary, secret: sensitive }),
        'hub-client',
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(String(error)).not.toContain(sensitive);
    }
  });

  it('returns a catalog and entries that consumers cannot modify', () => {
    const catalog = parseClientCatalog(catalogJson(), 'hub-client');
    const entry = resolveTool(catalog, 'beneficiary');

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { clientId: string }).clientId = 'changed';
    }).toThrow();
    expect(() => {
      (catalog as Record<string, unknown>).other = beneficiary;
    }).toThrow();
    expect(entry.clientId).toBe('beneficiary-interface');
  });
});
