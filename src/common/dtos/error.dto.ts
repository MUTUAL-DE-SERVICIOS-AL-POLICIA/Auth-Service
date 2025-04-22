import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class ErrorDto {
  @IsString()
  @IsNotEmpty()
  message?: string;

  @IsPositive()
  @IsNumber()
  statusCode: number;

  @IsObject()
  data: object;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  args?: Array<string>;
}
