import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { google } from 'googleapis';
import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IState } from './types/state';
import { CompanySource } from '@prisma/client';

@Injectable()
export class GoogleWorkspaceService {
  private oAuth2Client: OAuth2Client;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {
    this.oAuth2Client = this.authFactory();
  }

  private authFactory(tokens?): OAuth2Client {
    const client = new OAuth2Client(
      this.config.getOrThrow('CLIENT_ID'),
      this.config.getOrThrow('CLIENT_SECRET'),
      `${this.config.getOrThrow('HOST')}/gdrive/auth/callback`,
    );

    if (tokens) {
      client.setCredentials(tokens);
    }

    return client;
  }

  async list() {
    const source = await this.prisma.companySource.findFirst({
      where: {
        meta: {
          not: null,
        },
      },
    });

    const auth = this.authFactory(source.meta);

    google
      .drive({
        version: 'v3',
        auth,
      })
      .files.list()
      .then((response) => {
        console.log(response.data);
      });
  }

  async listCalendars(sourceId: number) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        id: sourceId,
        meta: {
          not: null,
        },
      },
    });

    const auth = this.authFactory(source.meta);

    const response = await google
      .calendar({ auth, version: 'v3' })
      .calendarList.list();

    return response.data.items;
  }

  async addCalendarSource(
    sourceId: string,
    calendarIndex: string,
  ): Promise<CompanySource> {
    const source = await this.prisma.companySource.findFirst({
      where: {
        id: Number(sourceId),
      },
    });

    const client = this.authFactory(source.meta);

    const response = await google
      .calendar({ auth: client, version: 'v3' })
      .calendarList.list();

    return this.prisma.companySource.update({
      where: {
        id: Number(sourceId),
      },
      data: {
        link: response.data.items[calendarIndex].id,
        name: response.data.items[calendarIndex].summary,
      },
    });
  }

  async addCalendarEvent(companyId: number, event) {
    const source = await this.prisma.companySource.findFirst({
      where: {
        companyId,
        type: 'gcalendar',
        link: event.calendarId,
        meta: {
          not: null,
        },
      },
    });

    if (!source) {
      throw new BadRequestException('Source not found');
    }

    const auth = this.authFactory(source.meta);

    console.log(event);
    return google.calendar({ auth, version: 'v3' }).events.insert(event);
  }

  generateAuthUrl(state: IState, scope: string[]) {
    return this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope,
      include_granted_scopes: true,
      state: Buffer.from(JSON.stringify(state)).toString('base64url'),
    });
  }

  generateAuthUrlForDrive(state: IState): string {
    return this.generateAuthUrl(state, [
      'https://www.googleapis.com/auth/drive.readonly',
    ]);
  }

  generateAuthUrlForCalendar(state: IState): string {
    return this.generateAuthUrl(state, [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
  }

  async authCallback(code: string, state: IState) {
    const r = await this.oAuth2Client.getToken(code);

    const company = await this.prisma.company.findFirst({
      where: {
        id: Number(state.companyId),
      },
    });

    if (!company) {
      return;
    }

    const source = await this.prisma.companySource.create({
      data: {
        companyId: Number(state.companyId),
        link: '',
        type: state.sourceType,
        meta: JSON.stringify(r.tokens),
      },
    });

    this.eventEmitter.emit('sources.connected', { source, state });
  }
}
