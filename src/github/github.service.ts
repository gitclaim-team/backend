import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Probot, ProbotOctokit } from 'probot';

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private probot: Probot;

  onModuleInit() {
    this.probot = new Probot({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      secret: process.env.GITHUB_WEBHOOK_SECRET,
      // Optionally, you can specify Octokit options here
      // octokit: ProbotOctokit.defaults({})
    });

    this.probot.on('installation.created', async (context) => {
      this.logger.log('GitHub App installed:', context.payload);
    });

    this.probot.on('issue_comment.created', async (context) => {
      const issue = context.payload.issue;
      // Example: Only respond to comments on a specific issue number
      if (issue.number === 1) {
        this.logger.log('Comment on issue #1:', context.payload.comment.body);
      }
    });
  }

  getProbot() {
    return this.probot;
  }
} 