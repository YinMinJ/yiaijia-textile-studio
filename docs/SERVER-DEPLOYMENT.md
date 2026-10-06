# 织境服务器版

目标入口为 `https://jxcymj.asia/zhijing/`，放在门户首页底部“内部管理”区域，链接名称为“织境工作台”。门户其他入口和页面使用现有站点服务；织境使用独立进程和持久数据目录。

## 构建与运行

小内存服务器应使用 GitHub Actions 在 Ubuntu 22.04 构建的 Linux x64 发布包，服务器仅下载、核对 SHA256、解包和运行。工作流为 `.github/workflows/zhijing-server-release.yml`，发布版本采用 `zhijing-server-<完整提交 SHA>`，不覆盖旧版本。构建和隔离 HTTP 验证均使用临时数据与禁止上游请求的测试配置；发布包不包含作品、数据库、API 配置或登录资料。

工作流或打包脚本的提交会自动触发构建；普通应用更新后，需在 GitHub Actions 中对 `master` 手动运行该工作流。构建发布包不会自动修改生产服务器。

服务器需要 Node.js 24.11+ 和 pnpm。子路径与登录模式在构建时确定；服务器与本机根路径版本分别构建。

```sh
APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_BASE_PATH=/zhijing pnpm build
```

运行变量见 `deploy/zhijing.env.example`：`APP_URL` 只填写域名来源 `https://jxcymj.asia`，路径由 `NEXT_PUBLIC_APP_BASE_PATH` 配置。必须设置 `APP_LOCAL_MODE=0`，服务器通过邮箱和密码登录。服务仅监听 `127.0.0.1:3010`，由现有 HTTPS Nginx 反向代理。

`deploy/zhijing.service` 使用 `/opt/zhijing/current` 发布目录、`/opt/zhijing/runtime/bin/node` 和 `/var/lib/zhijing` 数据目录；部署时建立专用系统账户 `zhijing`。Nginx 片段 `deploy/nginx-location.conf` 应加入现有域名 HTTPS 服务块，检查 `nginx -t` 后重载。先检查 3010 未被占用，再启动服务。

服务器运行单元限制 V8 旧堆为 256 MiB，并在 cgroup v2 下使用 `MemoryHigh=384M`、`MemoryMax=512M`、`MemorySwapMax=0`。这些上限只约束织境，不能保证其他服务的内存用量；大图或并发任务可能使织境被终止并重启。Ubuntu 22.04 可通过 `stat -fc %T /sys/fs/cgroup` 确认 `cgroup2fs`，启动后检查 `systemctl show zhijing -p MemoryCurrent -p MemoryHigh -p MemoryMax -p MemorySwapMax`。不要在共用的小内存生产服务器上执行依赖安装和生产编译。

管理员账户用 `scripts/create-user.mjs` 创建，密码通过交互输入或标准输入 JSON 传递，不作为命令行参数。没有公开注册功能。每个账户独立保存作品、素材和 API 配置，退出登录会撤销当前会话。

## 仅导入 API 配置

先创建服务器账号，再将私密 JSON 经标准输入传给 `scripts/import-model-settings.mjs`。输入字段为 `targetEmail`、`sourceEncryptionSecret` 和 `settings`（源 `model_settings` 行）；只接收配置，不接收作品或账户数据。原密钥仅用于解密输入，保存时使用服务器自己的加密主密钥和目标账号 ID 重新加密。已有配置默认拒绝覆盖，明确替换时使用 `overwrite: true`。脚本不请求模型服务或打印密钥。

```sh
DATA_DIR=/var/lib/zhijing node scripts/import-model-settings.mjs < /受保护目录/model-settings-input.json
```

私密输入不进入源码包或仓库；导入后移除服务器暂存的输入文件。本次用户选择不迁移本机作品，只配置现有自定义 API。

## 数据与更新

本机已有数据迁移须获得用户同意。SQLite、`uploads/` 与 `encryption-secret` 成组迁移；不要只复制数据库。原本机用户为 `local-user`，已保存 API 密文使用该 ID 作为校验数据，迁移登录身份时须保留该所有者 ID 或重新加密配置，不能只修改配置表的 `owner_id`。

构建输出、运行数据、API 密钥和登录资料不上传 GitHub。服务器发布使用新目录，持久数据独立保留；上线前备份门户首页、Nginx 配置和原有织境数据（若存在），并记录修改前后文件指纹。更新失败可切回上一发布目录及还原门户/Nginx备份。

验证包括匿名跳转登录、会话路径 `/zhijing`、Vue 脚本/CSS/字体/照片读取、作品保存回读、账户隔离、API 配置解密和退出失效。排版与 HTTP 验证不调用付费模型。
