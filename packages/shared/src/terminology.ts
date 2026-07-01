import type { Terminology } from './types';

// 缺 key 兜底，绝不让 UI 渲染出 undefined
export const DEFAULT_TERMINOLOGY: Terminology = {
  point: '点位',
  point_short: '位',
  session: '服务',
  item: '商品',
  kitchen_ticket: '履约单',
  customer_ticket: '凭证',
  sold_out: '售罄',
  processing: '处理中',
  fulfill: '交付',
};

// 行业预设
export const INDUSTRY_PRESETS: Record<string, Partial<Terminology>> = {
  restaurant: {
    point: '桌台', point_short: '桌', session: '就餐', item: '菜品',
    kitchen_ticket: '后厨单', customer_ticket: '小票',
    sold_out: '沽清', processing: '备餐中', fulfill: '上菜',
  },
  retail: {
    point: '自提柜', point_short: '柜', session: '取货', item: '货品',
    kitchen_ticket: '拣货单', customer_ticket: '取货凭证',
    sold_out: '缺货', processing: '拣货中', fulfill: '交付',
  },
  service: {
    point: '工位', point_short: '位', session: '服务', item: '服务项',
    kitchen_ticket: '工单', customer_ticket: '服务单',
    sold_out: '约满', processing: '服务中', fulfill: '完成',
  },
};

// 合并顺序：默认 ← 行业预设 ← 门店自定义
export function resolveTerminology(
  industryType?: string,
  storeOverride?: Partial<Terminology>,
): Terminology {
  return {
    ...DEFAULT_TERMINOLOGY,
    ...(industryType ? INDUSTRY_PRESETS[industryType] ?? {} : {}),
    ...(storeOverride ?? {}),
  };
}
