import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Bounty } from '../github/bounty.model';
import { VlayerService } from '../vlayer/vlayer.service';

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
          freshPrEntry.webproof_json = webproofJson;
          await freshBounty.save();
          logger.log(`[background] Stored webproof_json for PR #${prNumber}`);

          // Post cha-ching comment to PR
          await githubContext.octokit.issues.createComment({
            owner: githubContext.payload.repository.owner.login,
            repo: githubContext.payload.repository.name,
            issue_number: prNumber,
            body: `Hey @${freshPrEntry.author},\n\nCHAAAA-CHIIIING! 🥳🥳🥳\n\nThe bounty was sent to your wallet. Enjoy! 🚀\n\nFeel free to come back and find more bounties at https://cha-ching.it`,
          });
        } catch (err) {
          logger.error(`[background] Failed to fetch/store vlayer webproof for PR #${prNumber}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(`[background] Unexpected error in background task for PR #${prNumber}: ${err.message}`);
  }
} 