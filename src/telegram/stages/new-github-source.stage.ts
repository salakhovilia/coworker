import { Markup, Scenes } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { CoworkerContext } from '../context';
import { ScenesIds } from './scenes';
import { BaseScene } from 'telegraf/typings/scenes';
import { GithubService } from '../../github/github.service';
import { RESPONSES } from '../responses';

export function newGithubSourceStageFactory(
  prisma: PrismaService,
  github: GithubService,
): BaseScene<CoworkerContext> {
  const newSourceScene = new Scenes.BaseScene<CoworkerContext>(
    ScenesIds.newGithubSource,
  );
  newSourceScene.enter(async (ctx: CoworkerContext) => {
    await ctx.editMessageText(RESPONSES.addGithub);
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        Markup.button.url(
          'Install',
          github.generateInstallationUrl({
            companyId: ctx.session.companyId,
            returnTo: { type: 'telegram', chatId: ctx.chat.id },
            sourceType: 'github',
          }),
        ),
      ]).reply_markup,
    );
  });

  return newSourceScene;
}
