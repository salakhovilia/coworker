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

  async addToContext(content: string, companyId: number) {
    await this.agentApi.post('/text', {
      content,
      meta: {
        companyId,
      },
    });
  }

  async ask(question: string, company: Company) {
    const response = await this.agentApi.post('/query', {
      question,
      companyId: company.id,
    });

    return response.data.response;
  }

  async generateEvent(command: string, company: Company) {
    const calendars = await this.prisma.companySource.findMany({
      where: {
        companyId: company.id,
        type: 'gcalendar',
      },
    });

    const calendarsData =
      '## Calendars\n' +
      calendars.map((c) => `name:${c.name} - id:${c.link}`).join(',');

    const response = await this.openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Generate event in json format for google calendar api based on chat history, current dateTime ${new Date().toISOString()}, { "calendarId": "<Id of calendar>", "requestBody": {"summary":"<title of event>", "description": "<description of event>", "start": {"date"?: "<date>", "dateTime"?: "<dateTime>", "timeZone"?: "<timezone>"}, "end": {"date"?: "<date>", "dateTime"?: "<dateTime>", "timeZone"?: "<timezone>"}}}`,
        },
        {
          role: 'user',
          content: `${calendarsData}\n## Command\n${command}`,
        },
      ],
      model: 'gpt-3.5-turbo',
      user: String(company.id),
      response_format: {
        type: 'json_object',
      },
    });

    const event = response.choices[0].message.content;

    try {
      return JSON.parse(event);
    } catch (err) {}

    return event;
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

  async uploadFileViaLink(company: Company, link: string) {
    await this.agentApi.post('/files/link', {
      link,
      companyId: company.id,
    });
  }
}
