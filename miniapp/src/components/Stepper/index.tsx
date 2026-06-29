import React from 'react';
import { View, Text } from '@tarojs/components';
import styles from './index.module.scss';

interface StepperProps {
  count: number;
  onAdd: () => void;
  onMinus: () => void;
}

const Stepper: React.FC<StepperProps> = ({ count, onAdd, onMinus }) => {
  return (
    <View className={styles.stepper}>
      {count > 0 && (
        <View className={styles.btnMinus} onClick={onMinus}>
          <Text className={styles.icon}>−</Text>
        </View>
      )}
      {count > 0 && <Text className={styles.count}>{count}</Text>}
      <View className={styles.btnAdd} onClick={onAdd}>
        <Text className={styles.icon}>+</Text>
      </View>
    </View>
  );
};

export default Stepper;
