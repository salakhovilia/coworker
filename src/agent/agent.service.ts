import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Company } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as process from 'node:process';
import { FormData } from 'formdata-node';

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
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow('OPENAI_API_KEY'), // This is the default and can be omitted
    });
  }

  async addToContext(
    content: string,
    companyId: number,
    meta: Record<string, any>,
  ) {
    await this.agentApi.post('/text', {
      content,
      companyId,
      meta,
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

    const response = await this.agentApi.post('calendars/event', {
      calendars: calendars.map((c) => ({ name: c.name, id: c.link })),
      command,
      companyId,
      meta,
    });

    return response.data.response;
  }

  async uploadFile(
    company: Company,
    file: ReadableStream,
    mimetype: string,
    contentLength: string,
    contentType: string,
  ) {
    const allowedTypes = [
      // 'text/x-c',
      // 'text/x-csharp',
      // 'text/x-c++',
      // 'application/msword',
      // 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // 'text/html',
      // 'text/x-java',
      // 'application/json',
      'text/markdown',
      'application/pdf',
      // 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // 'text/x-python',
      // 'text/x-script.python',
      // 'text/x-ruby',
      // 'text/x-tex',
      'text/plain',
      // 'text/css',
      // 'text/javascript',
      // 'application/x-sh',
      // 'application/typescript',
    ];

    if (!allowedTypes.includes(mimetype)) {
      return;
    }

    const form = new FormData();
    form.set('file', file);

    await this.agentApi.post('/files', form, {
      params: {
        companyId: company.id,
      },
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
}
