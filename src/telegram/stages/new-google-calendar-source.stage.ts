import { Markup, Scenes } from 'telegraf';
import { PrismaService } from '../../prisma/prisma.service';
import { CoworkerContext } from '../context';
import { ScenesIds } from './scenes';
import { BaseScene } from 'telegraf/typings/scenes';
import { GoogleWorkspaceService } from '../../google-workspace/google-workspace.service';
import { RESPONSES } from '../responses';

export function newGoogleCalendarSourceStageFactory(
  prisma: PrismaService,
  google: GoogleWorkspaceService,
): BaseScene<CoworkerContext> {
  const newSourceScene = new Scenes.BaseScene<CoworkerContext>(
    ScenesIds.newGoogleCalendarSource,
  );
  newSourceScene.enter(async (ctx: CoworkerContext) => {
    await ctx.editMessageText(RESPONSES.addGoogleCalendar);
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        Markup.button.url(
          'Allow',
          google.generateAuthUrlForCalendar({
            companyId: ctx.session.companyId,
            returnTo: { type: 'telegram', chatId: ctx.chat.id },
            sourceType: 'gcalendar',
          }),
        ),
      ]).reply_markup,
    );
  });

  return newSourceScene;
}
