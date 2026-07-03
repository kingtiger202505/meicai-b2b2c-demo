# ============================================================
# 扫码点餐小程序（Taro）→ H5 静态站，nginx 服务于 :8080
# 说明：真机 weapp 需在微信开发者工具上传，浏览器/QA 走 H5 构建。
# Supabase anon key 面向客户端可公开，构建期注入（TARO_APP_*）。
# ============================================================

# ---------- build stage ----------
# 用 glibc 版（非 alpine/musl）：Taro 原生 binding 依赖 @tarojs/binding-linux-x64-gnu
FROM node:22-slim AS build
WORKDIR /app/miniapp

# 构建期注入的前端配置（anon key 可公开；service_role/DB 密码绝不进这里）
ARG TARO_APP_SUPABASE_URL=""
ARG TARO_APP_SUPABASE_ANON_KEY=""
ARG TARO_APP_STORE_ID=""
ENV TARO_APP_SUPABASE_URL=$TARO_APP_SUPABASE_URL \
    TARO_APP_SUPABASE_ANON_KEY=$TARO_APP_SUPABASE_ANON_KEY \
    TARO_APP_STORE_ID=$TARO_APP_STORE_ID

# 先装依赖（含 devDependencies：Taro CLI 在 devDeps，故此处不设 NODE_ENV=production）
COPY miniapp/package.json miniapp/package-lock.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# 再拷源码并构建 H5（dist/）
COPY miniapp/ ./
RUN NODE_ENV=production npm run build:h5

# ---------- serve stage ----------
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/miniapp/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
