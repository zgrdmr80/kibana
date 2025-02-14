/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { IncomingMessage } from 'http';
import { cloneDeep, pick } from 'lodash';
import {
  BehaviorSubject,
  map,
  filter as rxJsFilter,
  scan,
  catchError,
  of,
  concatMap,
  shareReplay,
  finalize,
  delay,
} from 'rxjs';
import { HttpResponse } from '@kbn/core/public';
import { AbortError } from '@kbn/kibana-utils-plugin/common';
import {
  type RegisterContextDefinition,
  type RegisterFunctionDefinition,
  Message,
  MessageRole,
  ContextRegistry,
  FunctionRegistry,
} from '../../common/types';
import { ObservabilityAIAssistantAPIClient } from '../api';
import type {
  ChatRegistrationFunction,
  CreateChatCompletionResponseChunk,
  ObservabilityAIAssistantChatService,
  PendingMessage,
} from '../types';
import { readableStreamReaderIntoObservable } from '../utils/readable_stream_reader_into_observable';

export async function createChatService({
  signal: setupAbortSignal,
  registrations,
  client,
}: {
  signal: AbortSignal;
  registrations: ChatRegistrationFunction[];
  client: ObservabilityAIAssistantAPIClient;
}): Promise<ObservabilityAIAssistantChatService> {
  const contextRegistry: ContextRegistry = new Map();
  const functionRegistry: FunctionRegistry = new Map();

  const registerContext: RegisterContextDefinition = (context) => {
    contextRegistry.set(context.name, context);
  };

  const registerFunction: RegisterFunctionDefinition = (def, respond, render) => {
    functionRegistry.set(def.name, { options: def, respond, render });
  };

  const getContexts: ObservabilityAIAssistantChatService['getContexts'] = () => {
    return Array.from(contextRegistry.values());
  };
  const getFunctions: ObservabilityAIAssistantChatService['getFunctions'] = ({
    contexts,
    filter,
  } = {}) => {
    const allFunctions = Array.from(functionRegistry.values());

    return contexts || filter
      ? allFunctions.filter((fn) => {
          const matchesContext =
            !contexts || fn.options.contexts.some((context) => contexts.includes(context));
          const matchesFilter =
            !filter || fn.options.name.includes(filter) || fn.options.description.includes(filter);

          return matchesContext && matchesFilter;
        })
      : allFunctions;
  };

  await Promise.all(
    registrations.map((fn) => fn({ signal: setupAbortSignal, registerContext, registerFunction }))
  );

  return {
    executeFunction: async (name, args, signal) => {
      const fn = functionRegistry.get(name);

      if (!fn) {
        throw new Error(`Function ${name} not found`);
      }

      const parsedArguments = args ? JSON.parse(args) : {};

      // validate

      return await fn.respond({ arguments: parsedArguments }, signal);
    },
    renderFunction: (name, args, response) => {
      const fn = functionRegistry.get(name);

      if (!fn) {
        throw new Error(`Function ${name} not found`);
      }

      const parsedArguments = args ? JSON.parse(args) : {};

      const parsedResponse = {
        content: JSON.parse(response.content ?? '{}'),
        data: JSON.parse(response.data ?? '{}'),
      };

      // validate

      return fn.render?.({ response: parsedResponse, arguments: parsedArguments });
    },
    getContexts,
    getFunctions,
    hasRenderFunction: (name: string) => {
      return !!getFunctions().find((fn) => fn.options.name === name)?.render;
    },
    chat({ connectorId, messages }: { connectorId: string; messages: Message[] }) {
      const subject = new BehaviorSubject<PendingMessage>({
        message: {
          role: MessageRole.Assistant,
        },
      });

      const contexts = ['core', 'apm'];

      const functions = getFunctions({ contexts });

      const controller = new AbortController();

      client('POST /internal/observability_ai_assistant/chat', {
        params: {
          body: {
            messages,
            connectorId,
            functions: functions.map((fn) => pick(fn.options, 'name', 'description', 'parameters')),
          },
        },
        signal: controller.signal,
        asResponse: true,
        rawResponse: true,
      })
        .then((_response) => {
          const response = _response as unknown as HttpResponse<IncomingMessage>;

          const status = response.response?.status;

          if (!status || status >= 400) {
            throw new Error(response.response?.statusText || 'Unexpected error');
          }

          const reader = response.response.body?.getReader();

          if (!reader) {
            throw new Error('Could not get reader from response');
          }

          const subscription = readableStreamReaderIntoObservable(reader)
            .pipe(
              map((line) => line.substring(6)),
              rxJsFilter((line) => !!line && line !== '[DONE]'),
              map((line) => JSON.parse(line) as CreateChatCompletionResponseChunk),
              rxJsFilter((line) => line.object === 'chat.completion.chunk'),
              scan(
                (acc, { choices }) => {
                  acc.message.content += choices[0].delta.content ?? '';
                  acc.message.function_call.name += choices[0].delta.function_call?.name ?? '';
                  acc.message.function_call.arguments +=
                    choices[0].delta.function_call?.arguments ?? '';
                  return cloneDeep(acc);
                },
                {
                  message: {
                    content: '',
                    function_call: {
                      name: '',
                      arguments: '',
                      trigger: MessageRole.Assistant as const,
                    },
                    role: MessageRole.Assistant,
                  },
                }
              ),
              catchError((error) =>
                of({
                  ...subject.value,
                  error,
                  aborted: error instanceof AbortError || controller.signal.aborted,
                })
              )
            )
            .subscribe(subject);

          controller.signal.addEventListener('abort', () => {
            subscription.unsubscribe();
            subject.next({
              ...subject.value,
              aborted: true,
            });
            subject.complete();
          });
        })
        .catch((err) => {
          subject.next({
            ...subject.value,
            aborted: false,
            error: err,
          });
          subject.complete();
        });

      return subject.pipe(
        concatMap((value) => of(value).pipe(delay(50))),
        shareReplay(1),
        finalize(() => {
          controller.abort();
        })
      );
    },
  };
}
