import { Module } from '@nestjs/common';
import { VlayerService } from './vlayer.service';

@Module({
  providers: [VlayerService],
  exports: [VlayerService],
})
export class VlayerModule {} 