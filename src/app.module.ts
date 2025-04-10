import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import dataSource from './database/data-source';

@Module({
  imports: [AuthModule, TypeOrmModule.forRoot(dataSource.options)],
})
export class AppModule {}
