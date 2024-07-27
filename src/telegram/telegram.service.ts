import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import { AgentService } from '../agent/agent.service';
import { GoogleWorkspaceService } from '../google-workspace/google-workspace.service';
import * as process from 'node:process';
import { TelegramClient, Logger as TGLogger, Api } from 'telegram';
import { NewMessage } from 'telegram/events';
import { StringSession } from 'telegram/sessions';
import { LogLevel } from 'telegram/extensions/Logger';
import { toFile } from 'openai';
import { Readable } from 'stream';

class GramLogger extends TGLogger {
  static logger = new Logger('GramJS');
  log(level: LogLevel, message: string) {
    switch (level) {
      case LogLevel.NONE:
        GramLogger.logger.verbose(message);
        break;
      case LogLevel.DEBUG:
        GramLogger.logger.debug(message);
        break;
      case LogLevel.INFO:
        GramLogger.logger.log(message);
        break;
      case LogLevel.ERROR:
        GramLogger.logger.error(message);
        break;
      case LogLevel.WARN:
        GramLogger.logger.warn(message);
    }
  }
}

@Injectable()
export class TelegramService {
  private readonly client: TelegramClient;
  private me: Api.User;
  private commands: Record<
    string,
    (message: Api.Message) => void | Promise<void>
  > = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,

    private readonly agent: AgentService,
    private readonly googleWorkspace: GoogleWorkspaceService,
  ) {
    this.client = new TelegramClient(
      new StringSession(this.configService.get('TELEGRAM_SESSION')),
      Number(this.configService.getOrThrow('TELEGRAM_API_ID')),
      this.configService.getOrThrow<string>('TELEGRAM_API_HASH'),

      {
        useWSS: false,
        baseLogger: new GramLogger(LogLevel.WARN),
      },
    );

    this.client.connect().then(async () => {
      this.me = await this.client.getMe();
    });

    this.client.addEventHandler(async (event) => {
      const isHandled = await this.checkAndHandleCommand(event.message);

      if (isHandled) {
        return;
      }

      this.onMessage(event.message).catch((err) => {
        Logger.error(err);
      });
    }, new NewMessage({}));

    this.command('chatId', this.onGetChatId.bind(this));
    this.command('ask', this.onAsk.bind(this));
    this.command('calendar', this.onCalendar.bind(this));
  }

  command(name: string, handler: (message: Api.Message) => void) {
    this.commands[`/${name}`] = handler;
  }

  async checkAndHandleCommand(message: Api.Message) {
    for (const command of Object.keys(this.commands)) {
      if (command === message.text) {
        await this.commands[command](message);
        return true;
      }
    }

    return false;
  }

  async onMessage(message: Api.Message) {
    console.log(message);

    if (message.text) {
      await this.onText(message);
    }
  }

  async onGetChatId(message: Api.Message) {
    await message.reply({ message: `ChatId: ${message.chatId}` });
  }

  async onAsk(message: Api.Message, replyMessage?: Api.Message) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(message.chatId),
      },
      include: {
        company: true,
      },
    });

    if (!source) {
      return message.reply({ message: 'Source not found' });
    }

    let question = message.text;
    if (replyMessage) {
      question = `> ${replyMessage.text}\n${question}`;
    }

    let response;
    try {
      response = await this.agent.ask(
        question,
        source.companyId,
        await this.getMetaFromCtx(message, 'telegram', 'question'),
      );
    } catch (err) {
      Logger.error(err);
      await message.reply(err);
      return;
    }

    if (response) {
      await message.reply({
        message: response,
        parseMode: 'markdown',
        silent: true,
      });
    }
  }

  async onCalendar(message: Api.Message) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(message.chatId),
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
        message.text,
        source.company.id,
        await this.getMetaFromCtx(message, 'telegram', 'message'),
      );

      await this.googleWorkspace.processEvent(source.companyId, event);
      await message.reply(event.message);
    } catch (err) {
      Logger.error(err);
    }
  }

  async onText(message: Api.Message) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        type: 'chat',
        link: String(message.chatId),
      },
    });

    if (!source) {
      return;
    }

    const text = message.text;

    let replyMessage: Api.Message | undefined;
    if (message.replyTo) {
      replyMessage = await message.getReplyMessage();
    }

    if (
      text.includes(this.configService.get('TELEGRAM_USERNAME')) ||
      (replyMessage && replyMessage.senderId === this.me.id)
    ) {
      await this.onAsk(message, replyMessage);
      return;
    }

    const meta = await this.getMetaFromCtx(message, 'telegram', 'message');

    if (process.env.NODE_ENV === 'dev' || source.companyId === 2) {
      this.agent
        .suggest(text, source.companyId, meta)
        .then(async (answer) => {
          if (!answer) return;

          await message.reply({
            message: answer,
            parseMode: 'Markdown',
            silent: true,
          });
        })
        .catch((err) => {
          Logger.error(err);
        });
    }

    await this.agent.addToContext(message.id, text, source.companyId, meta);
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

  async onVoice(message: Api.Message) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        link: String(message.chatId),
        type: 'chat',
      },
      include: { company: true },
    });

    if (!source) {
      return;
    }

    const voice = this.client.iterDownload({
      file: new Api.InputPhotoFileLocation({
        id: message.voice.id,
        accessHash: message.voice.accessHash,
        fileReference: message.voice.fileReference,
        thumbSize: 'm',
      }),
      requestSize: message.voice.size.toJSNumber(),
    });

    const transcript = await this.agent.parseAudio(
      await toFile(Readable.from(voice)),
    );

    const meta = this.getMetaFromCtx(message, 'telegram', 'message');

    await this.agent.addToContext(
      message.id,
      transcript,
      source.companyId,
      meta,
    );
  }

  private async getMetaFromCtx(
    message: Api.Message,
    source: string,
    type: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const [chat, sender]: [Api.Chat, Api.User] = await Promise.all([
      message.getChat(),
      message.getSender(),
    ]);

    return {
      source,
      type,
      date: new Date(message.date * 1000).toISOString(),
      chatId: message.chatId.toJSNumber(),
      chatTitle: chat?.title,
      authorUsername: sender?.username,
      authorFirstName: sender?.firstName,
      authorLastName: sender?.lastName,
    };
  }

  beforeApplicationShutdown() {
    this.client.disconnect();
  }
}
