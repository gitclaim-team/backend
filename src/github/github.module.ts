import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Bounty, BountySchema } from './bounty.model';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bounty.name, schema: BountySchema }]),
  ],
  providers: [GithubService],
  controllers: [GithubController],
})
export class GithubModule {} 