import { IsOptional, IsString } from 'class-validator';

export class EvaluatePermissionDto {
  @IsString()
  sid!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** Origin del frontend (http(s)://host[:port]) para resolver clientId si no se manda explícito */
  @IsOptional()
  @IsString()
  origin?: string;

  /** Audience = clientId del recurso protegido (ej: "api-gateway") */
  @IsString()
  audience!: string;

  /** Nombre lógico del recurso en Keycloak (ej: "tasks", "orgs") */
  @IsString()
  resource!: string;

  /** Nombre lógico del sub-recurso en Keycloak (ej: "tasks", "orgs") */
  @IsOptional()
  @IsString()
  subResource?: string;

  /** Scope concreto a evaluar (ej: "create", "view-single") */
  @IsString()
  scope!: string;
}

export class EvaluatePermissionRes {
  ok!: true;
  audience!: string;
  resource!: string;
  scope!: string;
  /** true si UMA devolvió result=true, false en cualquier otro caso */
  granted!: boolean;
}