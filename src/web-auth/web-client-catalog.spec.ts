/// <reference types="jest" />
import {
  UnknownWebToolError,
  WebClientCatalogConfigError,
  parseWebClientCatalog,
  resolveWebTool,
} from './web-client-catalog';

const beneficiary = {
  clientId: 'beneficiary-interface',
  audience: 'beneficiary-interface',
  resourceServer: 'beneficiary-interface',
};

function catalogJson(entry: Record<string, unknown> = beneficiary): string {
  return JSON.stringify({ beneficiary: entry });
}

describe('web client catalog', () => {
  it('accepts an empty catalog', () => {
    expect(parseWebClientCatalog('{}', 'hub-client')).toEqual({});
    expect(parseWebClientCatalog(undefined, 'hub-client')).toEqual({});
  });

  it('accepts the approved beneficiary entry', () => {
    expect(parseWebClientCatalog(catalogJson(), 'hub-client')).toEqual({
      beneficiary,
    });
  });

  it('rejects malformed JSON and non-object roots', () => {
    for (const value of ['{invalid', '[]', 'null', '"catalog"']) {
      expect(() => parseWebClientCatalog(value, 'hub-client')).toThrow(
        WebClientCatalogConfigError,
      );
    }
  });

  it('rejects additional properties, including sensitive and HTTP metadata', () => {
    for (const property of ['secret', 'origins', 'url']) {
      expect(() =>
        parseWebClientCatalog(
          catalogJson({ ...beneficiary, [property]: 'forbidden-value' }),
          'hub-client',
        ),
      ).toThrow(WebClientCatalogConfigError);
    }
  });

  it('rejects absent, empty and non-normalized fields', () => {
    for (const entry of [
      {
        audience: beneficiary.audience,
        resourceServer: beneficiary.resourceServer,
      },
      { ...beneficiary, clientId: '' },
      { ...beneficiary, audience: ' beneficiary-interface' },
      { ...beneficiary, resourceServer: 'beneficiary-interface\u200b' },
    ]) {
      expect(() =>
        parseWebClientCatalog(catalogJson(entry), 'hub-client'),
      ).toThrow(WebClientCatalogConfigError);
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
      expect(() => parseWebClientCatalog(input, 'hub-client')).toThrow(
        WebClientCatalogConfigError,
      );
    }
  });

  it('rejects the Hub as a secondary context', () => {
    for (const property of [
      'clientId',
      'audience',
      'resourceServer',
    ] as const) {
      expect(() =>
        parseWebClientCatalog(
          catalogJson({ ...beneficiary, [property]: 'hub-client' }),
          'hub-client',
        ),
      ).toThrow(WebClientCatalogConfigError);
    }
  });

  it('rejects ambiguous technical identifiers between tools', () => {
    expect(() =>
      parseWebClientCatalog(
        JSON.stringify({ beneficiary, another: beneficiary }),
        'hub-client',
      ),
    ).toThrow(WebClientCatalogConfigError);
  });

  it('resolves only the exact configured tool key', () => {
    const catalog = parseWebClientCatalog(catalogJson(), 'hub-client');
    expect(resolveWebTool(catalog, 'beneficiary')).toEqual(beneficiary);
    for (const alias of [
      'beneficiary-interface',
      beneficiary.clientId,
      beneficiary.audience,
      'unknown',
    ]) {
      expect(() => resolveWebTool(catalog, alias)).toThrow(UnknownWebToolError);
    }
  });

  it('does not expose rejected values in configuration errors', () => {
    const sensitive = 'sensitive-value-that-must-not-be-echoed';
    try {
      parseWebClientCatalog(
        catalogJson({ ...beneficiary, secret: sensitive }),
        'hub-client',
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(String(error)).not.toContain(sensitive);
    }
  });

  it('returns a catalog and entries that consumers cannot modify', () => {
    const catalog = parseWebClientCatalog(catalogJson(), 'hub-client');
    const entry = resolveWebTool(catalog, 'beneficiary');

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
