import React from 'react';
import type { ChartLayer } from '../types';
import OrderBlockOverlay from '@/components/chart/OrderBlockOverlay';

export const orderBlockLayer: ChartLayer = {
  id: 'order_blocks',
  name: 'Order Blocks',
  shortName: 'OB',
  description: 'Validated Tier A/A+ Order Blocks, MT Midlines & Breakers with Interactive Inspector',
  icon: 'Layers',
  renderHtml(context) {
    return React.createElement(OrderBlockOverlay, { context });
  }
};

