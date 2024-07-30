import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import { Scenes, Telegraf, session, Markup } from 'telegraf';
import { newCompanyStageFactory } from './stages/new-company.stage';
import { CoworkerContext } from './context';
import { ScenesIds } from './stages/scenes';
import { newTelegramSourceStageFactory } from './stages/new-telegram-source.stage';
import { AgentService } from '../agent/agent.service';
import { newGoogleDriveSourceStageFactory } from './stages/new-gdrive-source.stage';
import { GoogleWorkspaceService } from '../google-workspace/google-workspace.service';
import { newGoogleCalendarSourceStageFactory } from './stages/new-google-calendar-source.stage';
import { OnEvent } from '@nestjs/event-emitter';
import * as process from 'node:process';
import { newGithubSourceStageFactory } from './stages/new-github-source.stage';
import { GithubService } from '../github/github.service';
import { TelegramService } from './telegram.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class TelegramAdminService {
  private bot: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,

    private readonly agent: AgentService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly githubService: GithubService,
    private readonly telegramService: TelegramService,

    @InjectQueue('sources') private sourcesQueue: Queue,
  ) {
    this.bot = new Telegraf<CoworkerContext>(
      this.configService.getOrThrow('TELEGRAM_TOKEN'),
    );

    this.bot.use(session());

    this.bot.start(this.onStart.bind(this));
    this.bot.command('chatId', this.onGetChatId.bind(this));

    const stage = new Scenes.Stage<CoworkerContext>([
      newCompanyStageFactory(this.prisma, this.agent),
      newTelegramSourceStageFactory(
        this.prisma,
        this.telegramService,
        this.sourcesQueue,
      ),
      newGoogleDriveSourceStageFactory(this.prisma, this.googleWorkspace),
      newGoogleCalendarSourceStageFactory(this.prisma, this.googleWorkspace),
      newGithubSourceStageFactory(this.prisma, this.githubService),
    ]);

    this.bot.use(stage.middleware());

    this.bot.action('showCompanies', this.onShowCompanies.bind(this));
    this.bot.action('addCompany', this.onAddCompany.bind(this));
    this.bot.action('addSource', this.onAddSource.bind(this));

    this.bot.action(/^company-(\d+)$/, this.onSelectCompany.bind(this));
    this.bot.action(
      /^select-calendar-(.*)-(.*)$/,
      this.onSelectCalendar.bind(this),
    );
    this.bot.action(/^newSource-scene-(.*)$/, this.onNewSource.bind(this));

    this.bot.launch();
  }

  async onStart(ctx: CoworkerContext) {
    await ctx.reply(
      "*Hello and Welcome!*\n\nI'm your AI assistant, here to help you with anything you need in our company. Whether you have questions, need assistance with tasks, or require information, I'm here to support you. Feel free to ask me anything!\n\n**How can I assist you today?**",
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Show companies', callback_data: 'showCompanies' },
              { text: 'Add company', callback_data: 'addCompany' },
            ],
            [{ text: 'Add source', callback_data: 'addSource' }],
          ],
        },
      },
    );
  }

  async onGetChatId(ctx: CoworkerContext) {
    await ctx.reply(`ChatId: ${ctx.chat.id}`);
  }

  async onShowCompanies(ctx: CoworkerContext) {
    const companies = await this.prisma.company.findMany({
      where: { adminChatId: ctx.chat.id },
    });

    if (!companies.length) {
      return ctx.reply('You dont have companies');
    }

    await ctx.reply('Your companies:', {
      reply_markup: {
        inline_keyboard: [
          companies.map((c) => ({ text: c.name, callback_data: 'empty' })),
        ],
      },
    });
  }

  onAddCompany(ctx: CoworkerContext) {
    ctx.scene.enter(ScenesIds.newCompany);
  }

  async onAddSource(ctx: CoworkerContext) {
    const companies = await this.prisma.company.findMany({
      where: { adminChatId: ctx.chat.id },
    });

    const buttons = [];
    for (const company of companies) {
      buttons.push({
        text: company.name,
        callback_data: `company-${company.id}`,
      });
    }

    await ctx.reply('Select company:', {
      reply_markup: {
        inline_keyboard: [buttons],
      },
    });
  }

  async onSelectCompany(ctx: CoworkerContext) {
    ctx.session.companyId = Number(ctx.match[1]);

    const sources = [
      {
        title: 'Telegram',
        scene: ScenesIds.newTelegramSource,
      },
      {
        title: 'Google Calendar',
        scene: ScenesIds.newGoogleCalendarSource,
      },
    ];

    // experimental features
    if (process.env.NODE_ENV === 'dev' || ctx.session.companyId === 2) {
      sources.push(
        {
          title: 'Google Drive',
          scene: ScenesIds.newGoogleDriveSource,
        },
        {
          title: 'Github',
          scene: ScenesIds.newGithubSource,
        },
      );
    }

    const BUTTONS_PER_ROW = 2;

    const buttons = [];
    let row = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];

      row.push({
        text: source.title,
        callback_data: `newSource-scene-${source.scene}`,
      });

      if (row.length === BUTTONS_PER_ROW || i === sources.length - 1) {
        buttons.push(row);
        row = [];
      }
    }

    await ctx.editMessageText('Choose source:');
    await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
  }

  onNewSource(ctx) {
    ctx.scene.enter(ctx.match[1]);
  }

  async callbackAuthGoogleCalendar(chatId: number, sourceId: number) {
    const calendars = await this.googleWorkspace.listCalendars(sourceId);

    if (!calendars.length) {
      return this.bot.telegram.sendMessage(chatId, 'You dont have calendars');
    }

    await this.bot.telegram.sendMessage(
      chatId,
      'Choose calendar:',
      Markup.inlineKeyboard(
        calendars.map((c, i) => {
          const data = `select-calendar-${i}-${sourceId}`;
          return {
            text: c.summary,
            callback_data: data,
          };
        }),
      ),
    );
  }

  async onSelectCalendar(ctx: CoworkerContext) {
    await this.googleWorkspace.addCalendarSource(ctx.match[2], ctx.match[1]);

    await ctx.reply(`Your calendar was added`);
  }

  async callbackGithub(chatId: string) {
    await this.bot.telegram.sendMessage(chatId, 'Github was added');
  }

  @OnEvent('sources.connected')
  onEvent({ source, state }) {
    if (state.returnTo.type !== 'telegram') {
      return;
    }

    switch (source.type) {
      case 'gcalendar':
        this.callbackAuthGoogleCalendar(state.returnTo.chatId, source.id).catch(
          (err) => Logger.error(err),
        );
        break;
      case 'github':
        this.callbackGithub(state.returnTo.chatId).catch((err) =>
          Logger.error(err),
        );
        break;
    }
  }

  beforeApplicationShutdown() {
    this.bot.stop();
  }
}
