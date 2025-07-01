import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Probot, ProbotOctokit } from 'probot';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bounty } from './bounty.model';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { ethers } from 'ethers';
import { FilecoinService } from '../upload/filecoin.service';
import { VlayerService } from '../vlayer/vlayer.service';
import { handleVlayerProofAndNotify } from '../tasks/background-tasks';

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private probot: Probot;

  constructor(
    @InjectModel(Bounty.name) private bountyModel: Model<Bounty>,
    private configService: ConfigService,
    private filecoinService: FilecoinService,
    private vlayerService: VlayerService,
  ) {}

  onModuleInit() {
    this.probot = new Probot({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      secret: process.env.GITHUB_WEBHOOK_SECRET,
      // Optionally, you can specify Octokit options here
      // octokit: ProbotOctokit.defaults({})
    });

    this.probot.on('installation', async (context) => {
      if (context.payload.action === 'created') {
        this.logger.log('GitHub App installed:', context.payload);
      }
    });

    this.probot.on('pull_request', async (context) => {
      try {
        const action = context.payload.action;
        // Handle PR closed and merged
        if (action === 'closed') {
          const pr = context.payload.pull_request;
          const repo = context.payload.repository;
          if (!pr || !repo) {
            this.logger.warn('[pull_request] Missing PR or repo info, skipping.');
            return;
          }
          // Only proceed if merged
          if (pr.merged_at && pr.merge_commit_sha) {
            const prBody = pr.body || '';
            // Extract EVM address from PR body
            const evmAddress = this.extractEvmAddress(prBody);
            // GitHub official keywords for closing issues
            const keywords = [
              'close', 'closes', 'closed',
              'fix', 'fixes', 'fixed',
              'resolve', 'resolves', 'resolved'
            ];
            const refRegex = new RegExp(
              `\\b(?:${keywords.join('|')})\\b[:\\s]*((?:[\\w-]+\\/[\\w-]+)?#\\d+)`,
              'gi'
            );
            const matches = [...prBody.matchAll(refRegex)];
            if (matches.length === 0) {
              this.logger.log(`[pull_request] No issue references found in PR #${pr.number}`);
              return;
            }
            for (const match of matches) {
              const ref = match[1]; // e.g., #44 or owner/repo#44
              let issueNumber: number | null = null;
              let issueRepo = `${repo.owner.login}/${repo.name}`;
              // Parse reference
              const crossRepoMatch = ref.match(/^([\w-]+)\/([\w-]+)#(\d+)$/);
              if (crossRepoMatch) {
                issueRepo = `${crossRepoMatch[1]}/${crossRepoMatch[2]}`;
                issueNumber = parseInt(crossRepoMatch[3], 10);
              } else {
                const sameRepoMatch = ref.match(/^#(\d+)$/);
                if (sameRepoMatch) {
                  issueNumber = parseInt(sameRepoMatch[1], 10);
                }
              }
              if (!issueNumber) {
                this.logger.warn(`[pull_request] Could not parse issue reference '${ref}' in PR #${pr.number}`);
                continue;
              }
              this.logger.log(`[pull_request] (CLOSED) PR #${pr.number} references issue #${issueNumber} in repo ${issueRepo}`);
              // Find the bounty for this issue and repo
              const bounty = await this.bountyModel.findOne({ issue: issueNumber, repo: `https://github.com/${issueRepo}` });
              if (!bounty) {
                this.logger.warn(`[pull_request] No bounty found for issue #${issueNumber} in repo ${issueRepo}`);
                continue;
              }
              // Find the PR entry
              let prEntry = bounty.pull_requests.find(existing => existing.number === pr.number && existing.repo === issueRepo);
              if (!prEntry) {
                this.logger.warn(`[pull_request] No PR entry found for PR #${pr.number} in bounty for issue #${issueNumber}`);
                continue;
              }
              // Compose the JSON for Filecoin
              const webproofJson = {
                issue_url: `https://github.com/${issueRepo}/issues/${issueNumber}`,
                recipient_address: prEntry.evm_address || evmAddress || '',
                dev_name: prEntry.author || pr.user?.login || 'unknown',
              };
              try {
                const webproofUrl = await this.filecoinService.uploadJsonToFilecoin(webproofJson);
                prEntry.webproof_source = webproofUrl;
                await bounty.save();
                this.logger.log(`[pull_request] Uploaded webproof for PR #${pr.number} and updated bounty.`);

                // Post gitclaim comment to PR
                await context.octokit.issues.createComment({
                  owner: repo.owner.login,
                  repo: repo.name,
                  issue_number: pr.number,
                  body: `Hey @${prEntry.author}, you will be able to 'cha-ching' your bounty soon! 🤑 \n We're processing things on-chain, but you don't need to worry with that. 🥳`
                });

                // Trigger vlayer proof in background
                setImmediate(() => {
                  handleVlayerProofAndNotify({
                    vlayerService: this.vlayerService,
                    bountyModel: this.bountyModel,
                    issueNumber,
                    issueRepo,
                    prNumber: pr.number,
                    githubContext: context,
                    logger: this.logger,
                  });
                });
              } catch (err) {
                this.logger.error(`[pull_request] Failed to upload webproof for PR #${pr.number}: ${err.message}`);
              }
            }
          }
          return;
        }
        if (action !== 'opened' && action !== 'edited') return;
        const pr = context.payload.pull_request;
        const repo = context.payload.repository;
        if (!pr || !repo) {
          this.logger.warn('[pull_request] Missing PR or repo info, skipping.');
          return;
        }
        const prBody = pr.body || '';
        // Extract EVM address from PR body
        const evmAddress = this.extractEvmAddress(prBody);
        // GitHub official keywords for closing issues
        const keywords = [
          'close', 'closes', 'closed',
          'fix', 'fixes', 'fixed',
          'resolve', 'resolves', 'resolved'
        ];
        // Improved regex: case-insensitive, word boundary, optional colon/whitespace
        const refRegex = new RegExp(
          `\\b(?:${keywords.join('|')})\\b[:\\s]*((?:[\\w-]+\\/[\\w-]+)?#\\d+)`,
          'gi'
        );
        const matches = [...prBody.matchAll(refRegex)];
        if (matches.length === 0) {
          this.logger.log(`[pull_request] No issue references found in PR #${pr.number}`);
          return;
        }
        for (const match of matches) {
          const ref = match[1]; // e.g., #44 or owner/repo#44
          let issueNumber: number | null = null;
          let issueRepo = `${repo.owner.login}/${repo.name}`;
          // Parse reference
          const crossRepoMatch = ref.match(/^([\w-]+)\/([\w-]+)#(\d+)$/);
          if (crossRepoMatch) {
            issueRepo = `${crossRepoMatch[1]}/${crossRepoMatch[2]}`;
            issueNumber = parseInt(crossRepoMatch[3], 10);
          } else {
            const sameRepoMatch = ref.match(/^#(\d+)$/);
            if (sameRepoMatch) {
              issueNumber = parseInt(sameRepoMatch[1], 10);
            }
          }
          if (!issueNumber) {
            this.logger.warn(`[pull_request] Could not parse issue reference '${ref}' in PR #${pr.number}`);
            continue;
          }
          this.logger.log(`[pull_request] PR #${pr.number} references issue #${issueNumber} in repo ${issueRepo}`);
          // Find the bounty for this issue and repo
          const bounty = await this.bountyModel.findOne({ issue: issueNumber, repo: `https://github.com/${issueRepo}` });
          if (!bounty) {
            this.logger.warn(`[pull_request] No bounty found for issue #${issueNumber} in repo ${issueRepo}`);
            continue;
          }
          // Find or create PR entry
          let prEntry = bounty.pull_requests.find(existing => existing.number === pr.number && existing.repo === issueRepo);
          if (!prEntry) {
            prEntry = {
              number: pr.number,
              repo: issueRepo,
              url: pr.html_url,
              author: pr.user?.login || 'unknown',
              createdAt: pr.created_at ? new Date(pr.created_at) : new Date(),
            };
            bounty.pull_requests.push(prEntry);
          }
          // If EVM address is found and valid, store and thank
          if (evmAddress && ethers.isAddress(evmAddress)) {
            prEntry.evm_address = evmAddress;
            await bounty.save();
            await context.octokit.issues.createComment({
              owner: repo.owner.login,
              repo: repo.name,
              issue_number: pr.number,
              body: `Thanks! Your address is ${evmAddress} and it will be eventually used to pay the bounty.`
            });
          } else {
            // Ask for EVM address if not present or invalid
            await context.octokit.issues.createComment({
              owner: repo.owner.login,
              repo: repo.name,
              issue_number: pr.number,
              body: `Hi @${pr.user.login}, please provide your EVM-compatible address (Ethereum address) in a comment below. This address will be used to pay the bounty. Only the PR author can provide this address.`
            });
          }
          await bounty.save();
          this.logger.log(`[pull_request] Linked PR #${pr.number} to bounty for issue #${issueNumber}`);
        }
      } catch (err) {
        this.logger.error(`[pull_request] Error handling PR event: ${err.message}`, err.stack);
      }
    });

    this.probot.on('issue_comment', async (context) => {
      if (context.payload.action === 'created') {
        const issue = context.payload.issue;
        const comment = context.payload.comment;
        // Check if the comment is on a pull request
        if (issue.pull_request) {
          const repo = context.payload.repository;
          const prNumber = issue.number;
          // Find the bounty for this PR
          const bounty = await this.bountyModel.findOne({ 'pull_requests.number': prNumber, repo: `https://github.com/${repo.owner.login}/${repo.name}` });
          if (!bounty) return;
          // Find the PR entry
          const prEntry = bounty.pull_requests.find(pr => pr.number === prNumber);
          if (!prEntry) return;
          // Only accept from PR author and if not already set
          if (prEntry.author === comment.user.login && !prEntry.evm_address) {
            const evmAddress = this.extractEvmAddress(comment.body);
            if (evmAddress && ethers.isAddress(evmAddress)) {
              prEntry.evm_address = evmAddress;
              await bounty.save();
              await context.octokit.issues.createComment({
                owner: repo.owner.login,
                repo: repo.name,
                issue_number: prNumber,
                body: `Thanks! Your address is ${evmAddress} and it will be eventually used to pay the bounty.`
              });
            }
          }
        }
      }
    });

    // Used for debugging:
    // this.probot.onAny(async (context) => {
    //   this.logger.log('Received event:', context.name, context.payload);
    // });
  }

  getProbot() {
    return this.probot;
  }

  // 1. Get issues in repos the app has access to
  async getAccessibleIssues(installationId: number): Promise<any[]> {
    // Use Probot's Octokit to list repos and issues
    const octokit = await this.probot.auth(installationId);
    const repos = await octokit.apps.listReposAccessibleToInstallation();
    const issues: any[] = [];
    for (const repo of repos.data.repositories) {
      const repoIssues = await octokit.issues.listForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: 'open',
      });
      issues.push(...repoIssues.data.map(issue => ({
        ...issue,
        repo: repo.name,
        owner: repo.owner.login,
      })));
    }
    return issues;
  }

  // 2. Create a bounty
  async createBounty(data: {
    repo: string;
    issue: number;
    amount: number;
    coin: string;
    chain_id: string;
    bountyOwner: string;
  }): Promise<Bounty> {
    // Validate repo URL
    const repoUrlPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/)?$/;
    const match = data.repo.match(repoUrlPattern);
    if (!match) {
      throw new Error('Invalid GitHub repository URL. It should be in the form https://github.com/owner/repo');
    }
    const owner = match[1];
    const repo = match[2];

    // Fetch languages from GitHub API
    let languagesArray = [];
    try {
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`);
      const languages = response.data;
      const total = (Object.values(languages) as number[]).reduce((sum, val) => sum + val, 0);
      languagesArray = (Object.entries(languages) as [string, number][]).map(([language, bytes]) => ({
        language,
        percentage: total > 0 ? Math.round((bytes / total) * 10000) / 100 : 0 // rounded to 2 decimals
      }));
    } catch (err) {
      throw new Error('Failed to fetch repository languages from GitHub.');
    }

    const bounty = new this.bountyModel({ ...data, languages: languagesArray });
    return bounty.save();
  }

  // 3. Get bounties by bountyOwner
  async getBountiesByOwner(bountyOwner: string): Promise<Bounty[]> {
    return this.bountyModel.find({ bountyOwner }).sort({ createdAt: -1 }).exec();
  }

  // 4. Get all bounties
  async getAllBounties(): Promise<Bounty[]> {
    return this.bountyModel.find().sort({ createdAt: -1 }).exec();
  }

  // 5. Get bounties by owner or all
  async getBountiesByOwnerOrAll(bountyOwner?: string): Promise<Bounty[]> {
    if (bountyOwner) {
      return this.bountyModel.find({ bountyOwner }).sort({ createdAt: -1 }).exec();
    } else {
      return this.bountyModel.find().sort({ createdAt: -1 }).exec();
    }
  }

  /**
   * Recommend bounties based on a natural language prompt using OpenAI o3-mini.
   * Returns top 10 bounties, ranked languages, and a recommendation summary.
   */
  async recommendBounties(prompt: string): Promise<any> {
    const openai = new OpenAI({ apiKey: this.configService.get('OPENAI_API_KEY') });
    // Provide a sample bounty document for context
    const sample = {
      repo: 'https://github.com/example/repo',
      issue: 123,
      amount: 100,
      coin: 'USDC',
      chain_id: '1',
      bountyOwner: 'octocat',
      status: 'open',
      languages: [
        { language: 'Solidity', percentage: 38.12 },
        { language: 'Go', percentage: 82.46 }
      ]
    };
    const systemPrompt = `You are an assistant that:
- Extracts and ranks programming languages from a user's description of their skills.
- Generates a MongoDB filter for the Bounty model, which has a 'languages' array of objects with 'language' (capitalized, e.g., "Solidity", "Go") and 'percentage' (0–100).
- If the user mentions 'golang', use 'Go' as the language name.
- The filter should match bounties where the most important languages from the user's prompt are present in the 'languages' array, with percentage >= 10.
- Also, provide a ranked list of languages and a short recommendation summary for the user.
- Return a JSON object with keys: filter, ranked_languages, recommendation.`;
    const userPrompt = `User description: "${prompt}"
Sample bounty document: ${JSON.stringify(sample)}
`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-0125', // o3-mini
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 512
    });
    let filter = {};
    let ranked_languages: string[] = [];
    let recommendation = '';
    try {
      const response = JSON.parse(completion.choices[0].message.content);
      filter = response.filter;
      ranked_languages = response.ranked_languages;
      recommendation = response.recommendation;
    } catch (e) {
      throw new Error('LLM did not return valid JSON: ' + completion.choices[0].message.content);
    }
    // Log the LLM-generated filter for debugging
    console.log('LLM filter:', JSON.stringify(filter, null, 2));
    // Language alias mapping
    const languageAliasMap: Record<string, string> = {
      'golang': 'Go',
      'go': 'Go',
      'typescript': 'TypeScript',
      'js': 'JavaScript',
      'py': 'Python',
      'solidity': 'Solidity',
      // Add more aliases as needed
    };
    // Normalize ranked_languages
    ranked_languages = ranked_languages.map(lang => languageAliasMap[lang.toLowerCase()] || lang);
    // Normalize filter: if it uses $elemMatch, update language names
    if (
      filter &&
      typeof filter === 'object' &&
      'languages' in filter &&
      filter.languages &&
      typeof filter.languages === 'object' &&
      '$elemMatch' in filter.languages &&
      filter.languages.$elemMatch &&
      typeof filter.languages.$elemMatch === 'object' &&
      'language' in filter.languages.$elemMatch
    ) {
      const lang = filter.languages.$elemMatch.language;
      if (typeof lang === 'string') {
        filter.languages.$elemMatch.language = languageAliasMap[lang.toLowerCase()] || lang;
      }
    }
    // Query the bounties using the generated filter
    const bounties = await this.bountyModel.aggregate([
      { $match: filter },
      { $addFields: {
        matchScore: {
          $sum: ranked_languages.map((lang, idx) => ({
            $let: {
              vars: {
                langObj: {
                  $first: {
                    $filter: {
                      input: "$languages",
                      as: "l",
                      cond: { $eq: ["$$l.language", lang] }
                    }
                  }
                }
              },
              in: {
                $multiply: [
                  { $ifNull: ["$$langObj.percentage", 0] },
                  1 / (idx + 1)
                ]
              }
            }
          }))
        }
      } },
      { $sort: { matchScore: -1, createdAt: -1 } },
      { $limit: 10 }
    ]);
    return {
      bounties,
      ranked_languages,
      recommendation
    };
  }

  // Helper function to extract EVM address from text
  private extractEvmAddress(text: string): string | null {
    if (!text) return null;
    // EVM addresses are 0x followed by 40 hex chars
    const match = text.match(/0x[a-fA-F0-9]{40}/);
    return match ? match[0] : null;
  }
} 