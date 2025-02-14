/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiLink,
  EuiLoadingSpinner,
  EuiPanel,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { UseKnowledgeBaseResult } from '../../hooks/use_knowledge_base';

export function KnowledgeBaseCallout({ knowledgeBase }: { knowledgeBase: UseKnowledgeBaseResult }) {
  let content: React.ReactNode;

  let color: 'primary' | 'danger' | 'plain' = 'primary';

  if (knowledgeBase.status.loading) {
    content = (
      <EuiFlexGroup alignItems="center" gutterSize="s">
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="s" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {i18n.translate('xpack.observabilityAiAssistant.checkingKbAvailability', {
              defaultMessage: 'Checking availability of knowledge base',
            })}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  } else if (knowledgeBase.status.error) {
    color = 'danger';
    content = (
      <EuiText size="xs" color={color}>
        {i18n.translate('xpack.observabilityAiAssistant.failedToGetStatus', {
          defaultMessage: 'Failed to get model status.',
        })}
      </EuiText>
    );
  } else if (knowledgeBase.status.value?.ready) {
    color = 'plain';
    content = (
      <EuiText size="xs" color="subdued">
        {i18n.translate('xpack.observabilityAiAssistant.poweredByModel', {
          defaultMessage: 'Powered by {model}',
          values: {
            model: 'ELSER',
          },
        })}
      </EuiText>
    );
  } else if (knowledgeBase.isInstalling) {
    color = 'primary';
    content = (
      <EuiFlexGroup alignItems="center" gutterSize="s">
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="s" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color={color}>
            {i18n.translate('xpack.observabilityAiAssistant.installingKb', {
              defaultMessage: 'Setting up the knowledge base',
            })}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  } else if (knowledgeBase.installError) {
    color = 'danger';
    content = (
      <EuiText size="xs" color={color}>
        {i18n.translate('xpack.observabilityAiAssistant.failedToSetupKnowledgeBase', {
          defaultMessage: 'Failed to set up knowledge base.',
        })}
      </EuiText>
    );
  } else if (!knowledgeBase.status.value?.ready && !knowledgeBase.status.error) {
    content = (
      <EuiLink
        onClick={() => {
          knowledgeBase.install();
        }}
      >
        <EuiText size="xs">
          {i18n.translate('xpack.observabilityAiAssistant.setupKb', {
            defaultMessage: 'Improve your experience by setting up the knowledge base.',
          })}
        </EuiText>
      </EuiLink>
    );
  }

  return (
    <EuiPanel hasBorder={false} hasShadow={false} borderRadius="none" color={color} paddingSize="s">
      {content}
    </EuiPanel>
  );
}
