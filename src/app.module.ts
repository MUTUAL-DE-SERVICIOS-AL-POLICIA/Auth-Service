import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import dataSource from './database/data-source';

@Module({
  imports: [AuthModule, TypeOrmModule.forRoot(dataSource.options), UserModule],
})
export class AppModule {}
