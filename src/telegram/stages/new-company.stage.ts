import { Scenes } from 'telegraf';

import { PrismaService } from '../../prisma/prisma.service';
import { CoworkerContext } from '../context';
import { message } from 'telegraf/filters';
import { ScenesIds } from './scenes';
import { BaseScene } from 'telegraf/typings/scenes';
import { AgentService } from 'src/agent/agent.service';

export function newCompanyStageFactory(
  prisma: PrismaService,
  agent: AgentService,
): BaseScene<CoworkerContext> {
  const newCompanyScene = new Scenes.BaseScene<CoworkerContext>(
    ScenesIds.newCompany,
  );
  newCompanyScene.enter(async (ctx: CoworkerContext) => {
    await ctx.reply('Enter company name:');
  });

  newCompanyScene.on(message('text'), async (ctx) => {
    const name = ctx.message.text as string;

    await prisma.company.create({
      data: {
        adminChatId: ctx.chat.id,
        name,
      },
    });

    await ctx.reply(`Company ${name} added`);
  });

  return newCompanyScene;
}
