import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import { Scenes, Telegraf, session, Markup } from 'telegraf';
import { newCompanyStageFactory } from './stages/new-company.stage';
import { CoworkerContext } from './context';
import { ScenesIds } from './stages/scenes';
import { newTelegramSourceStageFactory } from './stages/new-telegram-source.stage';
import { message } from 'telegraf/filters';
import { AgentService } from '../agent/agent.service';
import { newGoogleDriveSourceStageFactory } from './stages/new-gdrive-source.stage';
import { GoogleWorkspaceService } from '../google-workspace/google-workspace.service';
import { newGoogleCalendarSourceStageFactory } from './stages/new-google-calendar-source.stage';
import { OnEvent } from '@nestjs/event-emitter';
import * as process from 'node:process';
import { newGithubSourceStageFactory } from './stages/new-github-source.stage';
import { GithubService } from '../github/github.service';

@Injectable()
export class TelegramService {
  private bot: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,

    private readonly agent: AgentService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly githubService: GithubService,
  ) {
    this.bot = new Telegraf<CoworkerContext>(
      this.configService.getOrThrow('TELEGRAM_TOKEN'),
    );

    this.bot.use(session());

    this.bot.start(this.onStart.bind(this));
    this.bot.command('chatId', this.onGetChatId.bind(this));
    this.bot.command('ask', this.onAsk.bind(this));
    this.bot.command('calendar', this.onCalendar.bind(this));

    const stage = new Scenes.Stage<CoworkerContext>([
      newCompanyStageFactory(this.prisma, this.agent),
      newTelegramSourceStageFactory(this.prisma),
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

    this.bot.on(message('text'), this.onText.bind(this));
    this.bot.on(message('document'), this.onDocument.bind(this));
    this.bot.on(message('voice'), this.onVoice.bind(this));
    this.bot.on(message('photo'), this.onPhoto.bind(this));

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

  async onAsk(ctx) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(ctx.chat.id),
      },
      include: {
        company: true,
      },
    });

    if (!source) {
      return ctx.reply('Source not found');
    }

    const chat = ctx.chat;

    let question = ctx.payload || (ctx.message.text as string);

    if (ctx.message.reply_to_message) {
      question = `> ${ctx.message.reply_to_message.text}\n${question}`;
    }

    let response;
    try {
      response = await this.agent.ask(question, source.companyId, {
        date: new Date(ctx.message.date * 1000).toISOString(),
        type: 'telegram-question',
        chatId: ctx.chat.id,
        chatTitle: chat.title,
        authorUsername: ctx.message.from.username,
        authorFirstName: ctx.message.from.first_name,
      });
    } catch (err) {
      Logger.error(err);
      ctx.reply(err);
      return;
    }

    if (response) {
      await ctx.reply(response, {
        parse_mode: 'Markdown',
        disable_notification: true,
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
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
      {
        title: 'Google Drive',
        scene: ScenesIds.newGoogleDriveSource,
      },
      {
        title: 'Github',
        scene: ScenesIds.newGithubSource,
      },
    ];

    // experimental features
    if (process.env.NODE_ENV === 'dev' || ctx.session.companyId === 2) {
      // sources.push();
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

  async onCalendar(ctx) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(ctx.chat.id),
      },
      include: {
        company: true,
      },
    });

    if (!source) {
      return;
    }

    try {
      const event = await this.agent.generateEvent(
        ctx.payload,
        source.company.id,
        this.getMetaFromCtx(ctx, 'telegram-message'),
      );

      await this.googleWorkspace.processEvent(source.companyId, event);
      ctx.reply(event.message);
    } catch (err) {
      Logger.error(err);
    }
  }

  async onText(ctx) {
    const message = ctx.message.text as string;

    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(ctx.chat.id),
      },
    });

    if (!source) {
      return;
    }

    if (
      message.includes(this.configService.get('TELEGRAM_BOT_ID')) ||
      ctx.message.reply_to_message?.from.username ===
        this.configService.get('TELEGRAM_BOT_ID')
    ) {
      await this.onAsk(ctx);
      return;
    }

    const meta = this.getMetaFromCtx(ctx, 'telegram-message');

    if (process.env.NODE_ENV === 'dev' || source.companyId === 2) {
      this.agent
        .suggest(message, source.companyId, meta)
        .then(async (answer) => {
          if (!answer) return;

          await ctx.reply(answer, {
            parse_mode: 'Markdown',
            disable_notification: true,
            reply_parameters: { message_id: ctx.message.message_id },
          });
        })
        .catch((err) => {
          Logger.error(err);
        });
    }

    await this.agent.addToContext(message, source.companyId, meta);
  }

  async onDocument(ctx) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        link: String(ctx.chat.id),
        type: 'chat',
      },
      include: { company: true },
    });

    if (!source) {
      return;
    }

    const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);

    this.agent
      .uploadFileViaLink(source.company.id, link, {
        date: new Date(ctx.message.date * 1000).toISOString(),
        type: 'telegram-file',
        chatId: ctx.chat.id,
        chatTitle: ctx.chat.title,
        authorUsername: ctx.message.from.username,
        authorFirstName: ctx.message.from.first_name,
      })
      .catch((err) => {
        console.error(err);
      });
  }

  async onVoice(ctx) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        link: String(ctx.chat.id),
        type: 'chat',
      },
      include: { company: true },
    });

    if (!source) {
      return;
    }

    const link: string = await ctx.telegram.getFileLink(
      ctx.message.voice.file_id,
    );
    const response = await fetch(link, {
      method: 'GET',
    });
    const transcript = await this.agent.parseAudio(response);

    const meta = this.getMetaFromCtx(ctx, 'telegram-message');

    await this.agent.addToContext(transcript, source.companyId, meta);
  }

  async onPhoto() {}

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

  private getMetaFromCtx(ctx, type) {
    return {
      date: new Date(ctx.message.date * 1000).toISOString(),
      type,
      chatId: ctx.chat.id,
      chatTitle: ctx.chat.title,
      authorUsername: ctx.message.from.username,
      authorFirstName: ctx.message.from.first_name,
    };
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
        this.callbackGithub(state.returnTo.chatId);
        break;
    }
  }

  beforeApplicationShutdown() {
    this.bot.stop();
  }
}
