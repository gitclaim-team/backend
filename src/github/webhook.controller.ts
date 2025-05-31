import { Controller, All, Req, Res } from '@nestjs/common';
import { GithubService } from './github.service';
import { Request, Response } from 'express';

@Controller('github/webhook')
export class GithubWebhookController {
  constructor(private readonly githubService: GithubService) {}

  @All()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const probot = this.githubService.getProbot();
    const event = req.headers['x-github-event'] as string;
    const id = req.headers['x-github-delivery'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;
    try {
      await probot.webhooks.receive({
        id,
        name: event as any,
        payload: req.body,
      });
      res.status(200).send('Event received');
    } catch (err) {
      res.status(500).send('Error processing event');
    }
  }
} 