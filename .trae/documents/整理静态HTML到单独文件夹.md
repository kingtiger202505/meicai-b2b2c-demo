# 整理静态 HTML 到单独文件夹

## 摘要

把根目录下 4 个静态 HTML 原型目录(`admin/`、`pos/`、`supplier/`、`user/`)及公共样式 `assets/` 一起整体平移到新文件夹 `static-html/`。由于这 5 个目录之间互引全用 `../` 同级相对路径,整体平移后相对层级不变,**HTML 内部所有引用无需修改**。仅需更新从仓库其他位置(`README.md`、`docs/功能讲解.md`)指向这些 HTML 的路径。部署链路(Dockerfile / nginx / deploy.yml)和新版 SPA(`apps/pos`、`apps/admin`、`miniapp`)均不引用这些静态 HTML,不受影响。

## 现状分析(Phase 1 探索结论)

### 涉及的静态 HTML(共 38 个)
- `admin/`:17 个(管理后台原型:categories、disputes、index、inquiries、inventory、member-levels、operation-logs、orders、permissions、product-review、products、ratings、refunds、staff、supplier-audit、suppliers、users)
- `pos/`:11 个(POS 原型:daily、dishes、index、inventory、kitchen、member、orders、payment、purchase、refund、tables)
- `supplier/`:4 个(供应商端:my-quotes、orders、product-publish、supplier-join)
- `user/`:6 个(老版用户端 H5:cart、index、inquiry-publish、my-inquiries、orders、products)
- `assets/css/common.css`:被上述全部 38 个 HTML 通过 `<link rel="stylesheet" href="../assets/css/common.css">` 引用

### 目录间引用关系(全部为同级 `../` 互引)
- 所有 HTML → `../assets/css/common.css`(38 处)
- `user/*.html` → `../supplier/supplier-join.html` 等供应商页(8 处,见 user/index.html 等)
- `supplier/*.html` → `../user/index.html`(4 处,"返回首页"链接)
- `pos/purchase.html` → `../supplier/orders.html`(5 处,"供应商端"链接)

> **关键洞察**:这些引用全部是「同级目录互引」,层级关系为「同在仓库根下」。整体平移到 `static-html/` 后,它们仍「同在 static-html/ 下」,相对路径天然保持有效,**HTML 文件本身零改动**。

### 仓库其他位置对这些 HTML 的引用(需要改)
- `README.md` 第 27-30 行:目录结构表描述了 `pos/`、`admin/`、`supplier/`、`user/`、`assets/`
- `docs/功能讲解.md`:共 25 处提及这些 HTML
  - 行 67/75/83/91/99/107/115/123/131/142/150:正文里 `pos/index.html`、`pos/tables.html` 等(纯文本描述,非链接)
  - 行 180/188/196/204/212/220/228:`admin/index.html` 等(纯文本描述)
  - 行 242/250/258/266:`supplier/supplier-join.html` 等(纯文本描述)
  - 行 348-349:`[pos/purchase.html](../pos/purchase.html)` 与 `[supplier/my-quotes.html](../supplier/my-quotes.html)`(**markdown 相对链接,需改为 `../static-html/pos/purchase.html` 等**)

### 不受影响的部分(已确认)
- **部署链路**:`.github/workflows/deploy.yml` 的触发 paths 是 `miniapp/**`、`apps/pos/**`、`apps/admin/**`、`packages/**`、`Dockerfile*`、`docker-compose.yml`、`deploy/**`,**不含** `admin/`、`pos/`、`supplier/`、`user/`、`assets/`
- **Docker 构建**:`Dockerfile`(miniapp)、`Dockerfile.pos`、`Dockerfile.admin` 只 COPY 各自源码目录,不引用静态 HTML
- **nginx 配置**:`deploy/nginx*.conf` 服务 SPA 产物,不引用静态 HTML
- **新版 SPA 代码**:`apps/pos/src/`、`apps/admin/src/`、`miniapp/src/` 全部不引用 `common.css` 或静态 HTML(grep 已确认)
- **`.gitignore`**:不含这些目录,平移后仍正常追踪

## 变更内容

### 1. 新建目录并平移(纯 `git mv`,保留历史)

把以下 5 个根目录移动到 `static-html/` 下:

```
admin/        → static-html/admin/
pos/          → static-html/pos/
supplier/     → static-html/supplier/
user/         → static-html/user/
assets/       → static-html/assets/
```

执行后 `static-html/` 结构:
```
static-html/
  ├── admin/        (17 个 .html)
  ├── pos/          (11 个 .html)
  ├── supplier/     (4 个 .html)
  ├── user/         (6 个 .html)
  └── assets/
      └── css/
          └── common.css
```

**HTML 文件本身不改任何一行**(相对路径天然有效)。

### 2. 更新 `README.md`

第 22-31 行"目录结构"表:
- `pos/`、`admin/`、`supplier/`、`user/`、`assets/` 五行说明前缀改为 `static-html/...`,或加注"已归入 static-html/"
- 保持其余描述不变

具体改法:把表格中这 5 行的「目录」列从 `pos/` 改为 `static-html/pos/`,依此类推;「说明」「技术栈」列保持不变。

### 3. 更新 `docs/功能讲解.md`

- 行 348:`[pos/purchase.html](../pos/purchase.html)` → `[pos/purchase.html](../static-html/pos/purchase.html)`
- 行 349:`[supplier/my-quotes.html](../supplier/my-quotes.html)` → `[supplier/my-quotes.html](../static-html/supplier/my-quotes.html)`
- 其余 23 处纯文本提及(如行 67 "pos/index.html"、行 180 "admin/index.html" 等):**保持原样不动**。它们是正文叙述,不构成可点击链接,改了反而割裂阅读;且这些页面在新版 SPA 里也部分存在,语义上仍通顺。

### 4. 实施前最终核对(防漏)

移动前再 grep 一次,确认没有遗漏的引用点:
- `grep -rn "(\.\./|/)(admin|pos|supplier|user)/[a-z-]+\.html" --include=*.{ts,tsx,js,jsx,mjs,json,yml,yaml,conf,Dockerfile,md}` 排除 `static-html/` 自身,看是否还有命中
- 重点检查 `scripts/provision-store.mjs`、`supabase/functions/`、`packages/shared/` 是否引用(Phase 1 已抽样确认无,实施前再扫一遍兜底)

## 假设与决策

1. **新文件夹命名**:`static-html/`。语义清晰、中性(不暗示"废弃"),符合 README 现有"HTML + CSS + 原生 JS"描述。若你更倾向 `legacy-html/`、`prototypes/`、`static/`,实施前可一句话替换。
2. **不删不改任何 HTML 内容**:用户要求只是"放在一个单独文件夹",不涉及功能改动;HTML 内相对路径因整体平移而天然有效,改了反而引入风险。
3. **`docs/功能讲解.md` 的纯文本提及不改**:避免大面积文本改动,保持文档阅读连贯;只修可点击的 markdown 相对链接(共 2 处)。
4. **部署链不动**:这些静态 HTML 本来就没进 Docker 镜像、没被 nginx 服务,只是随 rsync 同步到服务器磁盘上作为原型存档。平移后仍会随 rsync 同步到 `static-html/` 路径下,行为一致。
5. **git mv 保留历史**:用 `git mv` 而非删后新建,确保 `git log --follow` 可追溯。

## 验证步骤

1. **目录结构**:执行 `LS static-html/` 确认 5 个子目录齐全;`LS` 根目录确认 `admin/`、`pos/`、`supplier/`、`user/`、`assets/` 已不存在
2. **HTML 引用完整性**:
   - `grep -rn "assets/css/common.css" static-html/` 应有 38 处命中(每个 HTML 一处)
   - `grep -rn "\.\./supplier/" static-html/user/` 应有命中(user 指向 supplier)
   - `grep -rn "\.\./user/" static-html/supplier/` 应有命中(supplier 指向 user)
   - 随机打开 1-2 个 HTML(如 `static-html/user/index.html`、`static-html/pos/purchase.html`)人工核对相对路径仍指向 `static-html/` 内的合法目标
3. **文档链接**:在 IDE 中点击 `docs/功能讲解.md` 第 348-349 行的两个 markdown 链接,确认能跳转到 `static-html/pos/purchase.html` 和 `static-html/supplier/my-quotes.html`
4. **无残留引用**:在仓库根(排除 `static-html/` 自身)grep `(\.\./|/)(admin|pos|supplier|user)/[a-z-]+\.html`,应只剩 `docs/功能讲解.md` 里的纯文本提及(非链接),`README.md` 已更新,无其他命中
5. **部署不受影响**:`docker compose build` 不应触发对这些目录的 COPY(本次任务不执行 build,仅靠静态分析确认 Dockerfile 不引用)
6. **git 状态**:`git status` 应显示 5 个目录被 rename( renamed: admin/index.html -> static-html/admin/index.html 等),无内容修改
