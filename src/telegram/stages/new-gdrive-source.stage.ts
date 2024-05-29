import { Markup, Scenes } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { CoworkerContext } from '../context';
import { ScenesIds } from './scenes';
import { BaseScene } from 'telegraf/typings/scenes';
import { GoogleWorkspaceService } from '../../google-workspace/google-workspace.service';

export function newGoogleDriveSourceStageFactory(
  prisma: PrismaService,
  gdrive: GoogleWorkspaceService,
): BaseScene<CoworkerContext> {
  const newSourceScene = new Scenes.BaseScene<CoworkerContext>(
    ScenesIds.newGoogleDriveSource,
  );
  newSourceScene.enter(async (ctx: CoworkerContext) => {
    await ctx.editMessageText('Allow access to your account');
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        Markup.button.url(
          'Allow',
          gdrive.generateAuthUrlForDrive({
            companyId: ctx.session.companyId,
            returnTo: { type: 'telegram', chatId: ctx.chat.id },
            sourceType: 'gdrive',
          }),
        ),
      ]).reply_markup,
    );
  });

  return newSourceScene;
}
