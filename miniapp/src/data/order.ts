import { Order } from '@/types';

export const orders: Order[] = [
  {
    id: 'DD20260625120001',
    items: [
      { dish: { id: 'd1', name: '番茄炒蛋', price: 9, categoryId: 'c2', desc: '', img: 'https://picsum.photos/id/292/300/300', sales: 1280, tags: [] }, count: 2 },
      { dish: { id: 'd2', name: '红烧排骨', price: 48, categoryId: 'c1', desc: '', img: 'https://picsum.photos/id/312/300/300', sales: 960, tags: [] }, count: 1 },
      { dish: { id: 'd13', name: '蛋炒饭', price: 18, categoryId: 'c4', desc: '', img: 'https://picsum.photos/id/326/300/300', sales: 1240, tags: [] }, count: 3 }
    ],
    totalPrice: 128,
    status: 'cooking',
    type: 'dineIn',
    tableNo: '3号桌',
    createTime: '今天 12:01',
    payMethod: '微信支付'
  },
  {
    id: 'DD20260624118015',
    items: [
      { dish: { id: 'd7', name: '麻婆豆腐', price: 22, categoryId: 'c2', desc: '', img: 'https://picsum.photos/id/580/300/300', sales: 1120, tags: [] }, count: 1 },
      { dish: { id: 'd8', name: '酸辣土豆丝', price: 16, categoryId: 'c2', desc: '', img: 'https://picsum.photos/id/625/300/300', sales: 1560, tags: [] }, count: 1 }
    ],
    totalPrice: 38,
    status: 'done',
    type: 'dineIn',
    tableNo: '5号桌',
    createTime: '昨天 12:05',
    payMethod: '支付宝'
  },
  {
    id: 'DD20260623115008',
    items: [
      { dish: { id: 'd12', name: '红烧牛腩面', price: 28, categoryId: 'c4', desc: '', img: 'https://picsum.photos/id/312/300/300', sales: 890, tags: [] }, count: 3 },
      { dish: { id: 'd14', name: '紫菜蛋花汤', price: 8, categoryId: 'c5', desc: '', img: 'https://picsum.photos/id/401/300/300', sales: 760, tags: [] }, count: 1 }
    ],
    totalPrice: 92,
    status: 'done',
    type: 'takeout',
    tableNo: '外卖配送',
    createTime: '06-23 11:50',
    payMethod: '微信支付'
  }
];
