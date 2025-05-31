import {Injectable, InternalServerErrorException} from '@nestjs/common';
import * as lighthouse from '@lighthouse-web3/sdk';
import * as fs from 'fs';
import * as os from 'os';
import {v4 as uuidv4} from 'uuid';
import {ConfigService} from '@nestjs/config';

/**
 * Service for interacting with Filecoin via Lighthouse
 *
 * This service provides functionality to upload JSON data to Filecoin
 * through the Lighthouse storage API. It handles the creation of temporary
 * files, uploading to IPFS/Filecoin, and returns accessible URLs.
 */
@Injectable()
export class FilecoinService {
  constructor(private configService: ConfigService) {
  }

  /**
   * Uploads JSON data to Filecoin via Lighthouse
   *
   * This method:
   * 1. Creates a temporary file with the JSON data
   * 2. Uploads it to Filecoin via Lighthouse API
   * 3. Returns a publicly accessible URL to retrieve the data
   *
   * @param data - The JSON data to upload to Filecoin
   * @returns A promise that resolves to the public URL where the JSON can be accessed
   * @throws InternalServerErrorException if the upload fails or API key is missing
   */
  async uploadJsonToFilecoin(data: Record<string, any>): Promise<string> {
    const tempFilename = `${uuidv4()}.json`;
    const tempPath = `${os.tmpdir()}/${tempFilename}`;
    const lighthouseApiKey = this.configService.get<string>('LIGHTHOUSE_API_KEY');

    if (!lighthouseApiKey) {
      throw new InternalServerErrorException('Lighthouse API key is not configured');
    }

    try {
      // Prettify JSON with 2-space indentation and only \n line terminators
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2).replace(/\r\n/g, '\n'));

      const response = await lighthouse.upload(tempPath, lighthouseApiKey);

      // Clean up
      fs.unlinkSync(tempPath);

      // Extract CID from the response and create a publicly accessible URL
      const cid = response.data.Hash;
      // Return only the URL
      return `https://gateway.lighthouse.storage/ipfs/${cid}`;
    } catch (error) {
      // Make sure to clean up the temp file even if there's an error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw new InternalServerErrorException('Failed to upload JSON to Filecoin', error.message);
    }
  }
}
