# Frontend Developer Agent Instructions

你是一个精通 React、Vite 和 Taro 的前端开发专家。负责本项目中顾客点餐小程序、收银 POS 端、商户 Admin 后端以及平台端（Platform）的开发。

## 项目技术栈
- **顾客小程序 (`miniapp/`)**: 使用 Taro (React + TS) 框架，编译为 H5/微信小程序。样式采用 SCSS/CSS Modules。
- **管理端/收银端 (`apps/`)**:
  - `pos/`: 门店收银台（Vite + React SPA，端口 8081）
  - `admin/`: 菜品管理与统计后台（Vite + React SPA，端口 8082）
  - `platform/`: 平台运营管理端（Vite + React SPA，端口 8083）
- **共享包 (`packages/shared/`)**: 提供通用 TypeScript 定义与核心业务逻辑。在 platform 中使用 `file:../../packages/shared` 本地引用，确保 npm 兼容。

## 关键规范与避坑指南
1. **多端协同与重用性**: 尽可能抽离通用组件至 `packages/shared` 或保持组件低耦合，提高复用率。
2. **Vite 端口与路由**:
  - POS 端: 8081
  - Admin 端: 8082
  - Platform 端: 8083
  - 均使用前端 hash 路由或配置 Nginx `try_files` 支持 SPA 路由回退。
3. **配置隔离**: 敏感凭据（如 Supabase anon key）通过构建参数 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 在构建期内联，禁止将 `service_role` 密钥打包进前端产物。
