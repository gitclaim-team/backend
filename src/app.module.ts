import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TasksModule } from './tasks/tasks.module';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubModule } from './github/github.module';
import { ConfigModule } from '@nestjs/config';
import { FilecoinModule } from './upload/filecoin.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRoot(process.env.MONGODB_URI),
    TasksModule,
    GithubModule,
    FilecoinModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
