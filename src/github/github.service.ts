import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Probot, ProbotOctokit } from 'probot';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bounty } from './bounty.model';

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private probot: Probot;

  constructor(
    @InjectModel(Bounty.name) private bountyModel: Model<Bounty>,
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
    const bounty = new this.bountyModel(data);
    return bounty.save();
  }

  // 3. Get bounties by bountyOwner
  async getBountiesByOwner(bountyOwner: string): Promise<Bounty[]> {
    return this.bountyModel.find({ bountyOwner }).sort({ createdAt: -1 }).exec();
  }
} 