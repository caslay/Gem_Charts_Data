import React from 'react';
import type { ChartLayer } from '../types';
import OrderBlockOverlay from '@/components/chart/OrderBlockOverlay';
import { IS_OB_STRATEGY_PAUSED } from '@/hooks/useLiveOrderBlockExecution';

export const orderBlockLayer: ChartLayer = {
  id: 'order_blocks',
  name: 'Order Blocks',
  shortName: 'OB',
  description: 'Validated Tier A/A+ Order Blocks, MT Midlines & Breakers with Interactive Inspector',
  icon: 'Layers',
  renderHtml(context) {
    if (IS_OB_STRATEGY_PAUSED) return null;
    return React.createElement(OrderBlockOverlay, { context });
  }
};

