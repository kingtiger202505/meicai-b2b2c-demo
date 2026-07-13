export default defineAppConfig({
  pages: [
    'pages/menu/index',
    'pages/order/index',
    'pages/mine/index',
    'pages/detail/index',
    'pages/orderDetail/index',
    'pages/paySuccess/index',
    'pages/topup/index',
    'pages/coupon/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ff6b00',
    navigationBarTitleText: '美菜点餐',
    navigationBarTextStyle: 'white'
  },
  tabBar: {
    color: '#86909c',
    selectedColor: '#ff6b00',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/menu/index', text: '点餐' },
      { pagePath: 'pages/order/index', text: '订单' },
      { pagePath: 'pages/mine/index', text: '我的' }
    ]
  }
})
