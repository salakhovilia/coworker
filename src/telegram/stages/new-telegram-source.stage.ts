import { Scenes } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { CoworkerContext } from '../context';
import { message } from 'telegraf/filters';
import { ScenesIds } from './scenes';
import { BaseScene } from 'telegraf/typings/scenes';
import { Logger } from '@nestjs/common';
import { TelegramService } from '../telegram.service';
import { Queue } from 'bull';
import { RESPONSES } from '../responses';

export function newTelegramSourceStageFactory(
  prisma: PrismaService,
  telegram: TelegramService,
  queue: Queue,
): BaseScene<CoworkerContext> {
  const newSourceScene = new Scenes.BaseScene<CoworkerContext>(
    ScenesIds.newTelegramSource,
  );
  newSourceScene.enter(async (ctx: CoworkerContext) => {
    ctx.session.newChatId = undefined;

    await ctx.editMessageText(RESPONSES.addTelegram);
  });

  newSourceScene.on(message('text'), async (ctx) => {
    const chatId = ctx.message.text as string;

    let chat;
    try {
      chat = await telegram.getChat(chatId);
    } catch (err) {
      return ctx.reply(err);
    }

    prisma.companySource
      .create({
        data: {
          name: chat?.title,
          companyId: ctx.session.companyId,
          link: String(chatId),
          type: 'chat',
        },
      })
      .then(() => {
        queue.add(
          {
            source: 'telegram',
            type: 'chat',
            chatId,
          },
          {
            priority: 2,
          },
        );
        ctx.reply('Done');
      })
      .catch((err) => {
        Logger.error(err);
      });
  });

  return newSourceScene;
}
