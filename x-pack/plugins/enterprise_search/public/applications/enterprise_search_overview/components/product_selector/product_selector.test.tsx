/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { setMockValues } from '../../../__mocks__/kea_logic';

import React from 'react';

import { shallow } from 'enzyme';

import { ErrorStateCallout } from '../../../shared/error_state';

import { SetupGuideCta } from '../setup_guide';
import { TrialCallout } from '../trial_callout';

import { ElasticsearchProductCard } from './elasticsearch_product_card';
import { EnterpriseSearchProductCard } from './enterprise_search_product_card';

import { ProductSelector } from '.';

describe('ProductSelector', () => {
  it('renders the overview page, product cards, & setup guide CTAs with no host set', () => {
    setMockValues({ config: { canDeployEntSearch: true, host: '' } });
    const wrapper = shallow(<ProductSelector />);

    expect(wrapper.find(ElasticsearchProductCard)).toHaveLength(1);
    expect(wrapper.find(EnterpriseSearchProductCard)).toHaveLength(1);
    expect(wrapper.find(SetupGuideCta)).toHaveLength(1);
  });

  it('renders the trial callout', () => {
    setMockValues({ config: { canDeployEntSearch: true, host: 'localhost' } });
    const wrapper = shallow(<ProductSelector />);

    expect(wrapper.find(TrialCallout)).toHaveLength(1);
  });

  it('does not render connection error callout without an error', () => {
    setMockValues({ config: { canDeployEntSearch: true, host: 'localhost' } });
    const wrapper = shallow(<ProductSelector />);

    expect(wrapper.find(ErrorStateCallout)).toHaveLength(0);
  });

  it('does render connection error callout with an error', () => {
    setMockValues({
      config: { canDeployEntSearch: true, host: 'localhost' },
      errorConnectingMessage: '502 Bad Gateway',
    });
    const wrapper = shallow(<ProductSelector />);

    expect(wrapper.find(ErrorStateCallout)).toHaveLength(1);
  });

  describe('access checks when host is set', () => {
    beforeEach(() => {
      setMockValues({ config: { canDeployEntSearch: true, host: 'localhost' } });
    });

    it('does not render the Setup CTA when there is a host', () => {
      const wrapper = shallow(<ProductSelector />);

      expect(wrapper.find(ElasticsearchProductCard)).toHaveLength(1);
      expect(wrapper.find(EnterpriseSearchProductCard)).toHaveLength(1);
      expect(wrapper.find(SetupGuideCta)).toHaveLength(0);
    });
  });
});
