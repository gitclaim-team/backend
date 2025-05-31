import { Controller, Post, Body } from '@nestjs/common';
import { FilecoinService } from './filecoin.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: FilecoinService) {}

  @Post()
  async handleUpload(@Body() data: Record<string, any>): Promise<string> {
    return this.uploadService.uploadJsonToFilecoin(data);
  }
}
