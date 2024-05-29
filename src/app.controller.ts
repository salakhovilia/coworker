import { Controller, Get, Query, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { GoogleWorkspaceService } from './google-workspace/google-workspace.service';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly appService: AppService,
    private readonly googleWorkspace: GoogleWorkspaceService,
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
}
