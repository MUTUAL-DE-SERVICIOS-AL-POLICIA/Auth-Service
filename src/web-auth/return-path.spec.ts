/// <reference types="jest" />
import { normalizeHubReturnPath } from './return-path';

describe('normalizeHubReturnPath', () => {
  it.each([
    ['/apphub', '/apphub'],
    ['/apphub/reports', '/apphub/reports'],
    [
      '/apphub/reports?page=2&filter=active',
      '/apphub/reports?page=2&filter=active',
    ],
  ])('accepts a Hub path: %s', (input, expected) => {
    expect(normalizeHubReturnPath(input)).toBe(expected);
  });

  it.each([
    'https://evil.test/apphub',
    '//evil.test/apphub',
    '/apphub\\evil',
    '/apphub#fragment',
    '/outside',
    '/apphub/../outside',
    '/apphub/%2e%2e/outside',
    '/apphub/%2F%2Fevil.test',
    '/%61pphub',
    '/apphub//ambiguous',
  ])('rejects an unsafe or ambiguous path: %s', (input) => {
    expect(() => normalizeHubReturnPath(input)).toThrow(
      'Invalid login request',
    );
  });
});
