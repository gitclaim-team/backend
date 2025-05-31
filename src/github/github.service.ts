import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Probot, ProbotOctokit } from 'probot';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bounty } from './bounty.model';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private probot: Probot;

  constructor(
    @InjectModel(Bounty.name) private bountyModel: Model<Bounty>,
    private configService: ConfigService,
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
      if (context.payload.action === 'opened') {
        const pr = (context.payload as any).pull_request;
        this.logger.log(`New PR opened: #${pr?.number} - ${pr?.title} by ${pr?.user?.login}`);
      }
    });

    this.probot.on('issue_comment', async (context) => {
      if (context.payload.action === 'created') {
        const issue = context.payload.issue;
        const comment = context.payload.comment;
        // Check if the comment is on a pull request
        if (issue.pull_request) {
          this.logger.log(`New comment on PR #${issue.number}: ${comment.body} by ${comment.user.login}`);
        } else {
          this.logger.log(`New comment on Issue #${issue.number}: ${comment.body} by ${comment.user.login}`);
        }
      }
    });

    // Listen for cross-referenced events on issues
    this.probot.on('issues', async (context) => {
      try {
        const payload = context.payload as any; // type assertion for cross-referenced event
        const event = payload.action;
        if (event !== 'cross-referenced') return;
        const source = payload.source;
        const issue = payload.issue;
        const repo = payload.repository;
        if (!source || !source.issue || !source.issue.pull_request) {
          this.logger.log('[cross-referenced] Source is not a PR, skipping.');
          return;
        }
        // Extract PR info
        const pr = source.issue;
        const prInfo = {
          number: pr.number,
          repo: repo && repo.owner && repo.name ? `${repo.owner.login}/${repo.name}` : 'unknown',
          url: pr.html_url,
          author: pr.user?.login || 'unknown',
          createdAt: pr.created_at ? new Date(pr.created_at) : new Date()
        };
        this.logger.log(`[cross-referenced] PR #${prInfo.number} in ${prInfo.repo} references issue #${issue?.number}`);
        // Find the bounty for this issue and repo
        if (!issue || !repo || !repo.owner || !repo.name) {
          this.logger.warn('[cross-referenced] Missing issue or repo info, skipping.');
          return;
        }
        const bounty = await this.bountyModel.findOne({ issue: issue.number, repo: `https://github.com/${repo.owner.login}/${repo.name}` });
        if (!bounty) {
          this.logger.warn(`[cross-referenced] No bounty found for issue #${issue.number} in repo ${repo.owner.login}/${repo.name}`);
          return;
        }
        // Check if this PR is already linked
        if (bounty.pull_requests.some(pr => pr.number === prInfo.number && pr.repo === prInfo.repo)) {
          this.logger.log(`[cross-referenced] PR #${prInfo.number} already linked to bounty for issue #${issue.number}`);
          return;
        }
        // Add PR info to pull_requests
        bounty.pull_requests.push(prInfo);
        await bounty.save();
        this.logger.log(`[cross-referenced] Linked PR #${prInfo.number} to bounty for issue #${issue.number}`);
      } catch (err) {
        this.logger.error(`[cross-referenced] Error handling event: ${err.message}`, err.stack);
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
} 