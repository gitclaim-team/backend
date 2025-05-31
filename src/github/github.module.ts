import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Bounty, BountySchema } from './bounty.model';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bounty.name, schema: BountySchema }]),
    ConfigModule,
  ],
  providers: [GithubService],
  controllers: [GithubController],
})
export class GithubModule {} 