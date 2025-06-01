import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Bounty, BountySchema } from './bounty.model';
import { ConfigModule } from '@nestjs/config';
import { GithubWebhookController } from './webhook.controller';
import { FilecoinModule } from '../upload/filecoin.module';
import { VlayerModule } from '../vlayer/vlayer.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Bounty.name, schema: BountySchema }]),
    ConfigModule,
    FilecoinModule,
    VlayerModule,
  ],
  providers: [GithubService],
  controllers: [GithubController, GithubWebhookController],
})
export class GithubModule {} 