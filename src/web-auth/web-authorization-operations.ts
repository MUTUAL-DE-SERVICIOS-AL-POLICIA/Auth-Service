export type WebAuthorizationOperation = 'beneficiary.persons.read';

export interface WebAuthorizationTarget {
  readonly tool: string;
  readonly resource: string;
  readonly scope: string;
}

const operations = Object.freeze({
  'beneficiary.persons.read': Object.freeze({
    tool: 'beneficiary',
    resource: 'persons',
    scope: 'read',
  }),
}) satisfies Readonly<
  Record<WebAuthorizationOperation, WebAuthorizationTarget>
>;

export function resolveWebAuthorizationOperation(
  operation: unknown,
): Readonly<WebAuthorizationTarget> | undefined {
  if (typeof operation !== 'string') return undefined;
  return operations[operation as WebAuthorizationOperation];
}
