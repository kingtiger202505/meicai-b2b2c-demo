import React from 'react';
import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

const DetailPage: React.FC = () => {
  return (
    <View className={styles.page}>
      <Text className={styles.tip}>菜品详情页开发中...</Text>
      <Text className={styles.coming}>敬请期待</Text>
    </View>
  );
};

export default DetailPage;
