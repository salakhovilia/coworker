import { Context, Scenes } from 'telegraf';

export interface SceneSession extends Scenes.SceneSessionData {
  newCompanyName?: string;
  newChatId?: string;
  companyId: number;
}

export interface Session extends Scenes.SceneSession<SceneSession> {
  newCompanyName?: string;
  newChatId?: string;
  companyId: number;
}

export interface CoworkerContext extends Context {
  session: Session;
  scene: Scenes.SceneContextScene<CoworkerContext, SceneSession>;
  match: any;
  payload: string;
}
