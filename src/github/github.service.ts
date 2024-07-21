import { Injectable } from '@nestjs/common';
import { App } from 'octokit';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class GithubService {
  private app: App;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const privateKeyPath = this.config.getOrThrow('GITHUB_PRIVATE_KEY_PATH');

    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    this.app = new App({
      appId: this.config.getOrThrow('GITHUB_APP_ID'),
      oauth: {
        clientId: this.config.getOrThrow('GITHUB_CLIENT_ID'),
        clientSecret: this.config.getOrThrow('GITHUB_SECRET'),
      },
      privateKey,
      webhooks: { secret: this.config.getOrThrow('GITHUB_WEBHOOK_SECRET') },
    });

    this.app.webhooks.on('pull_request.opened', (event) => {
      this.createSummaryForPR(event);
    });

    this.app.webhooks.on('pull_request.edited', (event) => {
      this.createSummaryForPR(event);
    });

    this.app.webhooks.onAny((event) => {
      console.log(event.name);
    });
  }

  generateInstallationUrl(state: Record<string, any>) {
    const encodedState = Buffer.from(JSON.stringify(state)).toString(
      'base64url',
    );

    return `https://github.com/apps/CoWorkerAI/installations/new?state=${encodedState}`;
  }

  async receiveWebhook(options) {
    return this.app.webhooks.receive(options);
  }

  async createSummaryForPR(event) {
    if (!event.payload.pull_request.body?.includes('/summary')) {
      return;
    }

    const source = await this.prisma.companySource.findFirst({
      where: {
        link: event.payload.repository.full_name,
      },
    });

    if (!source) {
      return;
    }

    const [owner, repo] = event.payload.repository.full_name.split('/');
    const diff = await event.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: event.payload.number,
      mediaType: {
        format: 'diff',
      },
    });

    const summary = await this.agent.summaryGitDiff(
      diff.data as unknown as string,
      source.companyId,
    );

    await event.octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: event.payload.number,
      body: summary,
    });
  }

  async postInstall(installationCode: number, state: Record<string, any>) {
    const company = await this.prisma.company.findFirst({
      where: {
        id: Number(state.companyId),
      },
    });

    if (!company) {
      return;
    }

    const octokit = await this.app.getInstallationOctokit(installationCode);

    const reposResponse =
      await octokit.rest.apps.listReposAccessibleToInstallation();

    const repos = reposResponse.data.repositories.map((repo) => ({
      companyId: Number(state.companyId),
      link: repo.full_name,
      type: 'github-repo',
      meta: { installationCode } as Prisma.JsonObject,
    }));

    await this.prisma.companySource.createMany({
      data: repos,
    });

    this.eventEmitter.emit('sources.connected', {
      source: { type: 'github' },
      state,
    });
  }
}
