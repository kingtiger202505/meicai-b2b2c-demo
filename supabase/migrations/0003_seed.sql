-- ============================================================
-- P0 seed: 一个餐饮门店(川小灶) + 6 桌 + 分类 + 15 菜(复用原 Demo)
-- 幂等:固定 store id,重跑先清空该店数据再插
-- ============================================================
do $$
declare
  s_id uuid := '11111111-1111-1111-1111-111111111111';
  c_hot uuid; c_c1 uuid; c_c2 uuid; c_c3 uuid; c_c4 uuid; c_c5 uuid; c_c6 uuid;
begin
  -- 清旧数据(仅该 seed 店)
  delete from store where id=s_id;  -- cascade 清 point/session/category/item/order...

  insert into store(id,name,industry_type,terminology,theme) values
   (s_id,'川小灶·望京店','restaurant',
    '{"point":"桌台","point_short":"桌","session":"就餐","item":"菜品","kitchen_ticket":"后厨单","customer_ticket":"小票","sold_out":"沽清","processing":"备餐中","fulfill":"上菜"}'::jsonb,
    '{"primary":"#E43D30","tone":"warm"}'::jsonb);

  -- 桌台 T01..T06
  insert into service_point(store_id,code,name) values
   (s_id,'T01','1号桌'),(s_id,'T02','2号桌'),(s_id,'T03','3号桌'),
   (s_id,'T04','4号桌'),(s_id,'T05','5号桌'),(s_id,'T06','6号桌');

  -- 分类
  insert into category(store_id,name,sort) values (s_id,'热销',0) returning id into c_hot;
  insert into category(store_id,name,sort) values (s_id,'招牌热菜',1) returning id into c_c1;
  insert into category(store_id,name,sort) values (s_id,'家常小炒',2) returning id into c_c2;
  insert into category(store_id,name,sort) values (s_id,'凉菜',3) returning id into c_c3;
  insert into category(store_id,name,sort) values (s_id,'主食',4) returning id into c_c4;
  insert into category(store_id,name,sort) values (s_id,'汤品',5) returning id into c_c5;
  insert into category(store_id,name,sort) values (s_id,'饮品',6) returning id into c_c6;

  insert into item(store_id,category_id,name,price,unit,img,descr,sales,sort) values
   (s_id,c_hot,'番茄炒蛋',9,'份','https://picsum.photos/id/292/300/300','家常下饭神器，沙瓤番茄配鲜蛋',1280,0),
   (s_id,c_hot,'红烧排骨',48,'份','https://picsum.photos/id/312/300/300','招牌菜，猪排骨慢炖入味',960,1),
   (s_id,c_hot,'宫保鸡丁',38,'份','https://picsum.photos/id/326/300/300','川菜经典，鸡丁花生香辣',820,2),
   (s_id,c_hot,'鱼香肉丝',32,'份','https://picsum.photos/id/401/300/300','下饭神器，酸甜咸鲜',760,3),
   (s_id,c_c1,'红烧牛腩煲',68,'份','https://picsum.photos/id/431/300/300','进口牛腩慢炖，软烂入味',540,0),
   (s_id,c_c1,'水煮鱼片',52,'份','https://picsum.photos/id/570/300/300','麻辣鲜香，鱼片嫩滑',480,1),
   (s_id,c_c2,'麻婆豆腐',22,'份','https://picsum.photos/id/580/300/300','经典川菜，麻辣烫鲜',1120,0),
   (s_id,c_c2,'酸辣土豆丝',16,'份','https://picsum.photos/id/625/300/300','酸辣爽脆，开胃下饭',1560,1),
   (s_id,c_c2,'青椒肉丝',26,'份','https://picsum.photos/id/835/300/300','家常小炒，咸香可口',680,2),
   (s_id,c_c3,'凉拌黄瓜',12,'份','https://picsum.photos/id/1080/300/300','清爽开胃，蒜香入味',1380,0),
   (s_id,c_c3,'皮蛋豆腐',16,'份','https://picsum.photos/id/292/300/300','嫩滑北豆腐配皮蛋',520,1),
   (s_id,c_c4,'红烧牛腩面',28,'份','https://picsum.photos/id/312/300/300','招牌主食，牛腩浓汤拌面',890,0),
   (s_id,c_c4,'蛋炒饭',18,'份','https://picsum.photos/id/326/300/300','粒粒分明，蛋香浓郁',1240,1),
   (s_id,c_c5,'紫菜蛋花汤',8,'份','https://picsum.photos/id/401/300/300','清淡鲜美，饭后来一碗',760,0),
   (s_id,c_c6,'酸梅汤',6,'杯','https://picsum.photos/id/431/300/300','冰镇酸梅汤，解腻消暑',980,0);
end $$;
