import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as process from 'node:process';
import * as FormData from 'form-data';
import { GoogleWorkspaceService } from '../google-workspace/google-workspace.service';
import { Uploadable } from 'openai/uploads';
import { Readable } from 'stream';

export interface IDocument {
  id: string;
  content: string;
  meta: Record<string, string | number>;
}

@Injectable()
export class AgentService {
  private openai: OpenAI;
  private agentApi = axios.create({
    baseURL:
      process.env.NODE_ENV === 'production'
        ? 'http://agent:8000/api/agent'
        : 'http://localhost:8000/api/agent',
  });

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly googleWorkspace: GoogleWorkspaceService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow('OPENAI_API_KEY'), // This is the default and can be omitted
    });
  }

  async addToContext(companyId: number, documents: IDocument[]) {
    await this.agentApi.post('/documents', {
      companyId,
      documents,
    });
  }

  async suggest(message: string, companyId: number, meta: Record<string, any>) {
    const response = await this.agentApi.post('/suggest', {
      message,
      companyId,
      meta,
    });

    return response.data.response;
  }

  async ask(question: string, companyId: number, meta: Record<string, any>) {
    const response = await this.agentApi.post('/query', {
      question,
      companyId,
      meta,
    });

    return response.data.response;
  }

  async summaryGitDiff(diff: string, companyId: number) {
    const response = await this.agentApi.post('/git/diff/summary', {
      diff,
      companyId,
    });

    return response.data.response;
  }

  async generateEvent(command: string, companyId: number, meta) {
    const calendars = await this.prisma.companySource.findMany({
      where: {
        companyId,
        type: 'gcalendar',
        link: {
          not: '',
        },
        meta: {
          not: null,
        },
      },
    });

    const events = await Promise.all(
      calendars.map((c) => this.googleWorkspace.listEvents(companyId, c.link)),
    );

    const response = await this.agentApi.post('calendars/event', {
      calendars: calendars.map((c) => ({
        name: c.name,
        id: c.link,
        timeZone: (c.meta as Prisma.JsonObject).timeZone || 'UTC',
      })),
      events: events.flat().map((event) => ({
        id: event.id,
        summary: event.summary,
        description: event.description || '',
      })),
      command,
      companyId,
      meta,
    });

    return response.data.response;
  }

  async uploadFile(
    id: string,
    companyId: number,
    file: Readable,
    mimetype: string,
    meta: Record<string, any>,
  ) {
    const form = new FormData();
    form.append('id', id);
    form.append('companyId', companyId);
    form.append('file', file, {
      filename: 'mock',
      contentType: mimetype,
    });
    form.append('meta', JSON.stringify(meta));

    await this.agentApi.postForm('/files', form, {
      headers: form.getHeaders(),
    });
  }

  async uploadFileViaLink(
    companyId: number,
    link: string,
    meta: Record<string, any>,
  ) {
    await this.agentApi.post('/files/link', {
      link,
      companyId,
      meta,
    });
  }

  async parseAudio(file: Uploadable) {
    const response = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    });

    return response as unknown as string;
  }
}
