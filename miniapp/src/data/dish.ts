import { Dish, Category } from '@/types';

export const categories: Category[] = [
  { id: 'hot', name: '热销' },
  { id: 'c1', name: '招牌热菜' },
  { id: 'c2', name: '家常小炒' },
  { id: 'c3', name: '凉菜' },
  { id: 'c4', name: '主食' },
  { id: 'c5', name: '汤品' },
  { id: 'c6', name: '饮品' }
];

export const dishes: Dish[] = [
  { id: 'd1', name: '番茄炒蛋', price: 9, categoryId: 'hot', desc: '家常下饭神器，沙瓤番茄配鲜蛋', img: 'https://picsum.photos/id/292/300/300', sales: 1280, tags: ['热销', '招牌'] },
  { id: 'd2', name: '红烧排骨', price: 48, categoryId: 'hot', desc: '招牌菜，猪排骨慢炖入味', img: 'https://picsum.photos/id/312/300/300', sales: 960, tags: ['招牌'] },
  { id: 'd3', name: '宫保鸡丁', price: 38, categoryId: 'hot', desc: '川菜经典，鸡丁花生香辣', img: 'https://picsum.photos/id/326/300/300', sales: 820, tags: ['微辣'] },
  { id: 'd4', name: '鱼香肉丝', price: 32, categoryId: 'hot', desc: '下饭神器，酸甜咸鲜', img: 'https://picsum.photos/id/401/300/300', sales: 760, tags: [] },
  { id: 'd5', name: '红烧牛腩煲', price: 68, categoryId: 'c1', desc: '进口牛腩慢炖，软烂入味', img: 'https://picsum.photos/id/431/300/300', sales: 540, tags: ['招牌'] },
  { id: 'd6', name: '水煮鱼片', price: 52, categoryId: 'c1', desc: '麻辣鲜香，鱼片嫩滑', img: 'https://picsum.photos/id/570/300/300', sales: 480, tags: ['麻辣'] },
  { id: 'd7', name: '麻婆豆腐', price: 22, categoryId: 'c2', desc: '经典川菜，麻辣烫鲜', img: 'https://picsum.photos/id/580/300/300', sales: 1120, tags: ['下饭'] },
  { id: 'd8', name: '酸辣土豆丝', price: 16, categoryId: 'c2', desc: '酸辣爽脆，开胃下饭', img: 'https://picsum.photos/id/625/300/300', sales: 1560, tags: ['热销'] },
  { id: 'd9', name: '青椒肉丝', price: 26, categoryId: 'c2', desc: '家常小炒，咸香可口', img: 'https://picsum.photos/id/835/300/300', sales: 680, tags: [] },
  { id: 'd10', name: '凉拌黄瓜', price: 12, categoryId: 'c3', desc: '清爽开胃，蒜香入味', img: 'https://picsum.photos/id/1080/300/300', sales: 1380, tags: ['爽口'] },
  { id: 'd11', name: '皮蛋豆腐', price: 16, categoryId: 'c3', desc: '嫩滑北豆腐配皮蛋', img: 'https://picsum.photos/id/292/300/300', sales: 520, tags: [] },
  { id: 'd12', name: '红烧牛腩面', price: 28, categoryId: 'c4', desc: '招牌主食，牛腩浓汤拌面', img: 'https://picsum.photos/id/312/300/300', sales: 890, tags: ['招牌'] },
  { id: 'd13', name: '蛋炒饭', price: 18, categoryId: 'c4', desc: '粒粒分明，蛋香浓郁', img: 'https://picsum.photos/id/326/300/300', sales: 1240, tags: ['热销'] },
  { id: 'd14', name: '紫菜蛋花汤', price: 8, categoryId: 'c5', desc: '清淡鲜美，饭后来一碗', img: 'https://picsum.photos/id/401/300/300', sales: 760, tags: [] },
  { id: 'd15', name: '酸梅汤', price: 6, categoryId: 'c6', desc: '冰镇酸梅汤，解腻消暑', img: 'https://picsum.photos/id/431/300/300', sales: 980, tags: ['冰镇'] }
];
