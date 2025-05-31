import { Controller, Post, Req, Res, All, Get, Query, Body } from '@nestjs/common';
import { GithubService } from './github.service';
import { Request, Response } from 'express';

@Controller('github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Get('issues')
  async getIssues(@Query('installationId') installationId: string, @Res() res: Response) {
    try {
      const issues = await this.githubService.getAccessibleIssues(Number(installationId));
      res.status(200).json(issues);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch issues', details: err.message });
    }
  }

  @Post('bounties')
  async createBounty(@Body() body: any, @Res() res: Response) {
    try {
      if (!body.coin) {
        return res.status(400).json({ error: 'coin is required' });
      }
      const bounty = await this.githubService.createBounty(body);
      res.status(201).json(bounty);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create bounty', details: err.message });
    }
  }

  @Get('bounties')
  async getBounties(@Query('bountyOwner') bountyOwner: string, @Res() res: Response) {
    try {
      const bounties = await this.githubService.getBountiesByOwnerOrAll(bountyOwner);
      res.status(200).json(bounties);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch bounties', details: err.message });
    }
  }

  @Post('recommend-bounties')
  async recommendBounties(@Body('prompt') prompt: string, @Res() res: Response) {
    try {
      const result = await this.githubService.recommendBounties(prompt);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to recommend bounties', details: err.message });
    }
  }
} 