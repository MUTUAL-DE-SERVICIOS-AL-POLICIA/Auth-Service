export type ClientTokenSet = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  roles?: string[];
};

export type SessionData = {
  tokenType: string;
  sub?: string;
  clients: Record<string, ClientTokenSet>;
  uma?: {
    [audience: string]: {
      items: string[];
      fetchedAt: number;
    }
  }
};

export type PendingData = {
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
};