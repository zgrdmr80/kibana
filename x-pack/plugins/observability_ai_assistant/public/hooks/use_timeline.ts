/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AbortError } from '@kbn/kibana-utils-plugin/common';
import type { AuthenticatedUser } from '@kbn/security-plugin/common';
import { last } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Subscription } from 'rxjs';
import {
  ContextDefinition,
  MessageRole,
  type ConversationCreateRequest,
  type Message,
} from '../../common/types';
import type { ChatPromptEditorProps } from '../components/chat/chat_prompt_editor';
import type { ChatTimelineProps } from '../components/chat/chat_timeline';
import { EMPTY_CONVERSATION_TITLE } from '../i18n';
import { getAssistantSetupMessage } from '../service/get_assistant_setup_message';
import type { ObservabilityAIAssistantChatService, PendingMessage } from '../types';
import { getTimelineItemsfromConversation } from '../utils/get_timeline_items_from_conversation';
import type { UseGenAIConnectorsResult } from './use_genai_connectors';

export function createNewConversation({
  contexts,
}: {
  contexts: ContextDefinition[];
}): ConversationCreateRequest {
  return {
    '@timestamp': new Date().toISOString(),
    messages: [getAssistantSetupMessage({ contexts })],
    conversation: {
      title: EMPTY_CONVERSATION_TITLE,
    },
    labels: {},
    numeric_labels: {},
    public: false,
  };
}

export type UseTimelineResult = Pick<
  ChatTimelineProps,
  'onEdit' | 'onFeedback' | 'onRegenerate' | 'onStopGenerating' | 'items'
> &
  Pick<ChatPromptEditorProps, 'onSubmit'>;

export function useTimeline({
  messages,
  connectors,
  currentUser,
  chatService,
  onChatUpdate,
  onChatComplete,
}: {
  messages: Message[];
  connectors: UseGenAIConnectorsResult;
  currentUser?: Pick<AuthenticatedUser, 'full_name' | 'username'>;
  chatService: ObservabilityAIAssistantChatService;
  onChatUpdate: (messages: Message[]) => void;
  onChatComplete: (messages: Message[]) => void;
}): UseTimelineResult {
  const connectorId = connectors.selectedConnector;

  const hasConnector = !!connectorId;

  const conversationItems = useMemo(() => {
    const items = getTimelineItemsfromConversation({
      messages,
      currentUser,
      hasConnector,
      chatService,
    });

    return items;
  }, [messages, currentUser, hasConnector, chatService]);

  const [subscription, setSubscription] = useState<Subscription | undefined>();

  const controllerRef = useRef(new AbortController());

  const [pendingMessage, setPendingMessage] = useState<PendingMessage>();

  function chat(nextMessages: Message[]): Promise<Message[]> {
    const controller = new AbortController();

    return new Promise<PendingMessage | undefined>((resolve, reject) => {
      if (!connectorId) {
        reject(new Error('Can not add a message without a connector'));
        return;
      }

      onChatUpdate(nextMessages);

      const lastMessage = last(nextMessages);

      if (lastMessage?.message.function_call?.name) {
        // the user has edited a function suggestion, no need to talk to
        resolve(undefined);
        return;
      }

      const response$ = chatService!.chat({
        messages: nextMessages,
        connectorId,
      });

      let pendingMessageLocal = pendingMessage;

      const nextSubscription = response$.subscribe({
        next: (nextPendingMessage) => {
          pendingMessageLocal = nextPendingMessage;
          setPendingMessage(() => nextPendingMessage);
        },
        error: reject,
        complete: () => {
          resolve(pendingMessageLocal!);
        },
      });

      setSubscription(() => {
        controllerRef.current = controller;
        return nextSubscription;
      });
    }).then(async (reply) => {
      if (reply?.error) {
        return nextMessages;
      }
      if (reply?.aborted) {
        return nextMessages;
      }

      setPendingMessage(undefined);

      const messagesAfterChat = reply
        ? nextMessages.concat({
            '@timestamp': new Date().toISOString(),
            message: {
              ...reply.message,
            },
          })
        : nextMessages;

      onChatUpdate(messagesAfterChat);

      const lastMessage = last(messagesAfterChat);

      if (lastMessage?.message.function_call?.name) {
        const name = lastMessage.message.function_call.name;

        try {
          const message = await chatService!.executeFunction(
            name,
            lastMessage.message.function_call.arguments,
            controller.signal
          );

          return await chat(
            messagesAfterChat.concat({
              '@timestamp': new Date().toISOString(),
              message: {
                name,
                role: MessageRole.User,
                content: JSON.stringify(message.content),
                data: JSON.stringify(message.data),
              },
            })
          );
        } catch (error) {
          return await chat(
            messagesAfterChat.concat({
              '@timestamp': new Date().toISOString(),
              message: {
                role: MessageRole.User,
                name,
                content: JSON.stringify({
                  message: error.toString(),
                  error: error.body,
                }),
              },
            })
          );
        }
      }

      return messagesAfterChat;
    });
  }

  const items = useMemo(() => {
    if (pendingMessage) {
      return conversationItems.concat({
        id: '',
        actions: {
          canCopy: true,
          canEdit: false,
          canGiveFeedback: false,
          canRegenerate: pendingMessage.aborted || !!pendingMessage.error,
        },
        display: {
          collapsed: false,
          hide: pendingMessage.message.role === MessageRole.System,
        },
        content: pendingMessage.message.content,
        currentUser,
        error: pendingMessage.error,
        function_call: pendingMessage.message.function_call,
        loading: !pendingMessage.aborted && !pendingMessage.error,
        role: pendingMessage.message.role,
        title: '',
      });
    }

    return conversationItems;
  }, [conversationItems, pendingMessage, currentUser]);

  useEffect(() => {
    return () => {
      subscription?.unsubscribe();
    };
  }, [subscription]);

  return {
    items,
    onEdit: async (item, newMessage) => {
      const indexOf = items.indexOf(item);
      const sliced = messages.slice(0, indexOf - 1);
      const nextMessages = await chat(sliced.concat(newMessage));
      onChatComplete(nextMessages);
    },
    onFeedback: (item, feedback) => {},
    onRegenerate: (item) => {
      const indexOf = items.indexOf(item);
      chat(messages.slice(0, indexOf - 1)).then((nextMessages) => onChatComplete(nextMessages));
    },
    onStopGenerating: () => {
      subscription?.unsubscribe();
      setPendingMessage((prevPendingMessage) => ({
        message: {
          role: MessageRole.Assistant,
          ...prevPendingMessage?.message,
        },
        aborted: true,
        error: new AbortError(),
      }));
      setSubscription(undefined);
    },
    onSubmit: async (message) => {
      const nextMessages = await chat(messages.concat(message));
      onChatComplete(nextMessages);
    },
  };
}
