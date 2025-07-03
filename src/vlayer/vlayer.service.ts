import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { exec } from 'child_process';

@Injectable()
export class VlayerService {
  async fetchWebProof(urlToProve: string): Promise<string> {
    const notaryUrl = process.env.VLAYER_NOTARY_URL;
    const vlayerPath = process.env.VLAYER_BIN_PATH;
    
    // Log the request payload
    console.log('=== VLayer Service Request ===');
    console.log('URL to prove:', urlToProve);
    console.log('Notary URL:', notaryUrl);
    console.log('VLayer binary path:', vlayerPath);
    
    if (!notaryUrl) {
      throw new InternalServerErrorException('VLAYER_NOTARY_URL is not set in environment variables');
    }
    if (!vlayerPath) {
      throw new InternalServerErrorException('VLAYER_BIN_PATH is not set in environment variables');
    }
    const command = `${vlayerPath} web-proof-fetch --notary ${notaryUrl} --url ${urlToProve}`;
    
    // Log the exact command being executed
    console.log('Executing command:', command);
    console.log('=== VLayer Service Request End ===');
    
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.log('=== VLayer Service Error Response ===');
          console.log('Error:', error.message);
          console.log('Stderr:', stderr);
          console.log('=== VLayer Service Error Response End ===');
          reject(new InternalServerErrorException(`Failed to execute vlayer: ${stderr || error.message}`));
        } else {
          // Log the raw response
          console.log('=== VLayer Service Raw Response ===');
          console.log('Raw stdout:', stdout);
          console.log('Stderr (if any):', stderr);
          console.log('=== VLayer Service Raw Response End ===');
          
          // Find the last JSON object in the output
          const matches = stdout.match(/\{[\s\S]*\}/g);
          if (!matches || matches.length === 0) {
            console.log('=== VLayer Service Parsing Error ===');
            console.log('No JSON object found in output');
            console.log('=== VLayer Service Parsing Error End ===');
            reject(new InternalServerErrorException('No JSON object found in vlayer output'));
            return;
          }
          const rawJson = matches[matches.length - 1];
          if (!rawJson || rawJson.trim() === '{}') {
            console.log('=== VLayer Service Parsing Error ===');
            console.log('Proof was not generated or is empty');
            console.log('Raw JSON found:', rawJson);
            console.log('=== VLayer Service Parsing Error End ===');
            reject(new InternalServerErrorException('Proof was not generated or is empty'));
            return;
          }
          
          // Log the final parsed response
          console.log('=== VLayer Service Successful Response ===');
          console.log('vlayer command ran successfully.');
          console.log('Parsed JSON proof:', rawJson);
          console.log('=== VLayer Service Successful Response End ===');
          
          resolve(rawJson);
        }
      });
    });
  }
} 