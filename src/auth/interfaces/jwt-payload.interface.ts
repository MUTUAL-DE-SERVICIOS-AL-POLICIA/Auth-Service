export interface JwtPayload {
  user: {
    id: number;
    username: string;
    name: string;
  };
}
