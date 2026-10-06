# 织境服务器版

目标入口为 `https://jxcymj.asia/zhijing/`，放在门户首页底部“内部管理”区域，链接名称为“织境工作台”。门户其他入口和页面使用现有站点服务；织境使用独立进程和持久数据目录。

## 构建与运行

服务器需要 Node.js 24.11+ 和 pnpm。子路径与登录模式在构建时确定；服务器与本机根路径版本分别构建。

```sh
APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_BASE_PATH=/zhijing pnpm build
```

运行变量见 `deploy/zhijing.env.example`：`APP_URL` 只填写域名来源 `https://jxcymj.asia`，路径由 `NEXT_PUBLIC_APP_BASE_PATH` 配置。必须设置 `APP_LOCAL_MODE=0`，服务器通过邮箱和密码登录。服务仅监听 `127.0.0.1:3010`，由现有 HTTPS Nginx 反向代理。

`deploy/zhijing.service` 使用 `/opt/zhijing/current` 发布目录、`/opt/zhijing/runtime/bin/node` 和 `/var/lib/zhijing` 数据目录；部署时建立专用系统账户 `zhijing`。Nginx 片段 `deploy/nginx-location.conf` 应加入现有域名 HTTPS 服务块，检查 `nginx -t` 后重载。先检查 3010 未被占用，再启动服务。

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
