import { IsOptional, IsString } from 'class-validator';

export class GetPermissionsDto {
  @IsString()
  sid!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** Origin del frontend (http(s)://host[:port]) si quieres resolver clientId por URL */
  @IsOptional()
  @IsString()
  origin?: string;

  /** Audience = clientId del recurso protegido (ej: "api-gateway") */
  @IsString()
  audience!: string;

}

export class GetPermissionsRes {
  ok!: true;
  /** Audience para el que se evaluaron permisos */
  audience!: string;
  /** Lista de permisos normalizados tipo "resource#scope" */
  permissions!: any;
}