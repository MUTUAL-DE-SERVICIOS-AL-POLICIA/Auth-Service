import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class ErrorDto {
  @IsString()
  message?: string;

  @IsPositive()
  @IsNumber()
  statusCode: number;

  @IsObject()
  data: object;

  @IsArray()
  @IsOptional()
  args?: Array<string>;
}
