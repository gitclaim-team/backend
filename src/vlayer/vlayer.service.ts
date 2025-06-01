import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { exec } from 'child_process';

@Injectable()
export class VlayerService {
  async fetchWebProof(urlToProve: string): Promise<any> {
    const notaryUrl = process.env.VLAYER_NOTARY_URL;
    if (!notaryUrl) {
      throw new InternalServerErrorException('VLAYER_NOTARY_URL is not set in environment variables');
    }
    const command = `vlayer web-proof-fetch --notary ${notaryUrl} --url ${urlToProve}`;
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new InternalServerErrorException(`Failed to execute vlayer: ${stderr || error.message}`));
        } else {
          // Find the last JSON object in the output
          const matches = stdout.match(/\{[\s\S]*\}/g);
          if (!matches || matches.length === 0) {
            reject(new InternalServerErrorException('No JSON object found in vlayer output'));
            return;
          }
          try {
            const lastJson = JSON.parse(matches[matches.length - 1]);
            resolve(lastJson);
          } catch (parseErr) {
            reject(new InternalServerErrorException('Failed to parse JSON from vlayer output'));
          }
        }
      });
    });
  }
} 