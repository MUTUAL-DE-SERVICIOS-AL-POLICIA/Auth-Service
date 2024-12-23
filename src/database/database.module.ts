import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { options } from './data-source';

@Module({
  imports: [TypeOrmModule.forRoot({ ...options, autoLoadEntities: true })],
})
export class DatabaseModule {}
