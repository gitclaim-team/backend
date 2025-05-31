import { Module } from '@nestjs/common';
import { FilecoinService } from './filecoin.service';
import { UploadController } from './upload.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [UploadController],
  providers: [FilecoinService],
  exports: [FilecoinService],
})
export class FilecoinModule {}
