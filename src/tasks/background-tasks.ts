import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Bounty } from '../github/bounty.model';
import { VlayerService } from '../vlayer/vlayer.service';
import axios from 'axios';

/**
 * Handles fetching vlayer webproof, updating the bounty, and notifying the PR via GitHub comment.
 *
 * @param params - All required context and services
 */
export async function handleVlayerProofAndNotify({
  vlayerService,
  bountyModel,
  issueNumber,
  issueRepo,
  prNumber,
  githubContext,
  logger = new Logger('BackgroundTask'),
}: {
  vlayerService: VlayerService;
  bountyModel: Model<Bounty>;
  issueNumber: number;
  issueRepo: string;
  prNumber: number;
  githubContext: any; // Probot context
  logger?: Logger;
}) {
  try {
    // Re-fetch bounty and PR entry to avoid stale doc
    const freshBounty = await bountyModel.findOne({ issue: issueNumber, repo: `https://github.com/${issueRepo}` });
    if (freshBounty) {
      const freshPrEntry = freshBounty.pull_requests.find(
        (existing) => existing.number === prNumber && existing.repo === issueRepo
      );
      if (freshPrEntry && freshPrEntry.webproof_source) {
        try {
          const webproofJson = await vlayerService.fetchWebProof(freshPrEntry.webproof_source);
          logger.log(`[background] Fetched vlayer webproof for PR #${prNumber}: ${JSON.stringify(webproofJson)}`);
          // Call vlayer prove API before posting gitclaim comment
          try {
            const proveUrl = `${process.env.VLAYER_BACKEND_URL}/api/prove`;
            
            // Validate required environment variables
            if (!process.env.VLAYER_BACKEND_URL) {
              throw new Error('VLAYER_BACKEND_URL is not set in environment variables');
            }
            if (!process.env.PROVER_ADDRESS) {
              throw new Error('PROVER_ADDRESS is not set in environment variables');
            }
            if (!process.env.VERIFIER_ADDRESS) {
              throw new Error('VERIFIER_ADDRESS is not set in environment variables');
            }
            
            const provePayload = {
              url: freshPrEntry.webproof_source,
              proverAddress: process.env.PROVER_ADDRESS,
              verifierAddress: process.env.VERIFIER_ADDRESS,
              functionName: 'main',
              webProofJson: webproofJson,
            };
            
            // Log the request to vlayer backend
            logger.log(`[background] === VLayer Backend API Request ===`);
            logger.log(`[background] URL: ${proveUrl}`);
            logger.log(`[background] Payload: ${JSON.stringify(provePayload, null, 2)}`);
            logger.log(`[background] === VLayer Backend API Request End ===`);
            
            const proveResponse = await axios.post(proveUrl, provePayload);
            
            // Log the response from vlayer backend
            logger.log(`[background] === VLayer Backend API Response ===`);
            logger.log(`[background] Status: ${proveResponse.status}`);
            logger.log(`[background] Headers: ${JSON.stringify(proveResponse.headers, null, 2)}`);
            logger.log(`[background] Data: ${JSON.stringify(proveResponse.data, null, 2)}`);
            logger.log(`[background] === VLayer Backend API Response End ===`);
            // Check for HTTP 200 and no verificationError with revert or error
            if (
              proveResponse.status === 200 &&
              (!proveResponse.data.verificationError ||
                !/revert|error|expired|fail|invalid/i.test(proveResponse.data.verificationError))
            ) {
              freshPrEntry.webproof_json = webproofJson;
              await freshBounty.save();
              logger.log(`[background] Stored webproof_json for PR #${prNumber}`);

              // Post gitclaim comment to PR
              await githubContext.octokit.issues.createComment({
                owner: githubContext.payload.repository.owner.login,
                repo: githubContext.payload.repository.name,
                issue_number: prNumber,
                body: `Hey @${freshPrEntry.author},\n\nCHAAAA-CHIIIING! 🥳🥳🥳\n\nThe bounty was sent to your wallet. Enjoy! 🚀\n\nFeel free to come back and find more bounties at https://gitclaim.axlabs.com`,
              });
            } else {
              logger.error(
                `[background] vlayer prove API failed for PR #${prNumber}: ${proveResponse.data.verificationError || 'Unknown error'} `
              );
            }
          } catch (apiErr) {
            logger.error(`[background] === VLayer Backend API Error ===`);
            logger.error(`[background] Error calling vlayer prove API for PR #${prNumber}`);
            logger.error(`[background] Error message: ${apiErr.message}`);
            if (apiErr.response) {
              logger.error(`[background] Response status: ${apiErr.response.status}`);
              logger.error(`[background] Response data: ${JSON.stringify(apiErr.response.data, null, 2)}`);
              logger.error(`[background] Response headers: ${JSON.stringify(apiErr.response.headers, null, 2)}`);
            } else if (apiErr.request) {
              logger.error(`[background] No response received`);
              logger.error(`[background] Request: ${JSON.stringify(apiErr.request, null, 2)}`);
            }
            logger.error(`[background] === VLayer Backend API Error End ===`);
          }
        } catch (err) {
          logger.error(`[background] Failed to fetch/store vlayer webproof for PR #${prNumber}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(`[background] Unexpected error in background task for PR #${prNumber}: ${err.message}`);
  }
}
