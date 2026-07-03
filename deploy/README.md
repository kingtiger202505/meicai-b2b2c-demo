# 部署说明 — 扫码点餐小程序 H5（测试环境）

小程序主体是微信小程序（Taro，weapp），**真机版需在微信开发者工具上传**。
浏览器 / QA 走 **H5 构建**，用 nginx 静态服务于 **:8080**（80 已被占用）。

- 测试机：`150.158.236.166`
- 对外端口：`8080`
- QA 访问：`http://150.158.236.166.nip.io:8080`

## 一、需要人工提供的东西（否则无法真正部署 / 读真数据）

### 1. 测试机访问方式（二选一）
- **推荐（自动部署链路）**：为 GitHub Actions 配置 SSH 部署 key。
  1. 生成一对部署 key：`ssh-keygen -t ed25519 -C meicai-deploy -f meicai_deploy -N ""`
  2. 把 **公钥** `meicai_deploy.pub` 追加到测试机 `~/.ssh/authorized_keys`（对应下面的 `DEPLOY_USER`）。
  3. 把 **私钥** `meicai_deploy` 存为 GitHub 仓库 Secret `DEPLOY_SSH_KEY`。
- **或（我手动部署一次）**：给我一个可登录测试机的临时凭据（**不要贴在 issue 评论里**，走安全渠道），我 SSH 上去 `docker compose up -d --build`。

### 2. GitHub Actions Secrets（配 `.github/workflows/deploy.yml`）
| Secret | 说明 | 示例 |
|---|---|---|
| `DEPLOY_HOST` | 测试机 IP | `150.158.236.166` |
| `DEPLOY_USER` | 登录用户 | `root` |
| `DEPLOY_PORT` | SSH 端口（可选，默认 22） | `22` |
| `DEPLOY_PATH` | 部署目录（可选，默认 `/opt/meicai-miniapp`） | `/opt/meicai-miniapp` |
| `DEPLOY_SSH_KEY` | 上面生成的私钥 | `-----BEGIN ...` |
| `SUPABASE_URL` | Supabase 项目 URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key（可公开） | `eyJ...` |
| `STORE_ID` | 门店 id（可选，默认 seed 店） | `11111111-1111-1111-1111-111111111111` |

### 3. 测试机前置
- 已装 Docker + Docker Compose 插件（`docker compose version`）。
- 放行入站 `8080`（安全组 / 防火墙）。

### 4. Supabase 后端
- 确认已有 Supabase 项目，并已跑过 `supabase/migrations/*.sql`（schema + RLS + RPC + **seed**）。
  没有 seed，H5 打开会是空菜单。
- 提供上面的 `SUPABASE_URL` + `SUPABASE_ANON_KEY`（前端只用 anon key，符合设计）。

> `authorized_keys` 里已有的是**机器信任的公钥列表**，不代表把私钥给了我们；真要登录需要按上面 1 加我们的公钥或给凭据。

## 二、自动部署（推荐）
配好上面 Secrets 后，**推送到 `001` 分支**即触发 `.github/workflows/deploy.yml`：
rsync 源码到测试机 → `docker compose up -d --build` → `curl` 冒烟检查 `:8080`。

## 三、手动部署（等价，用于本地 / 首次验证）
```bash
# 在测试机上，仓库目录内：
cp miniapp/.env.example miniapp/.env    # 可选：本地 .env 也行
export TARO_APP_SUPABASE_URL="https://xxx.supabase.co"
export TARO_APP_SUPABASE_ANON_KEY="<anon-key>"
export TARO_APP_STORE_ID="11111111-1111-1111-1111-111111111111"
docker compose up -d --build
curl -fsSI http://127.0.0.1:8080     # 期望 200
```
访问 `http://150.158.236.166.nip.io:8080`。带桌号：`?point=T01`（或 `?table=3`）。
