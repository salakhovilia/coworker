import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { GoogleWorkspaceService } from './google-workspace/google-workspace.service';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github/github.service';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly appService: AppService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly githubService: GithubService,
  ) {}

  @Get('/gdrive/auth/callback')
  async authGDrive(@Query() query, @Res() res): Promise<void> {
    await this.googleWorkspace.authCallback(
      query.code,
      JSON.parse(Buffer.from(query.state, 'base64url').toString('utf8')),
    );

    return res.redirect(
      `https://t.me/${this.config.getOrThrow('TELEGRAM_BOT_USERNAME')}`,
    );
  }

  @Get('/callback/github/post-install')
  async githubPostInstall(@Query() query, @Res() res) {
    await this.githubService.postInstall(
      Number(query['installation_id']),
      JSON.parse(Buffer.from(query.state, 'base64url').toString('utf8')),
    );

    return res.redirect(
      `https://t.me/${this.config.getOrThrow('TELEGRAM_BOT_USERNAME')}`,
    );
  }

  @Post('/callback/github')
  async githubWebhook(@Req() request): Promise<void> {
    return this.githubService.receiveWebhook({
      id: request.headers['x-github-delivery'],
      name: request.headers['x-github-event'],
      signature: request.headers['x-hub-signature-256'],
      payload: request.body,
    });
  }
}
