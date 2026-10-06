# 织境服务器版

线上入口为 `https://jxcymj.asia/zhijing/`，已放在门户首页底部“内部管理”区域，链接名称为“织境工作台”。门户其他入口和页面使用现有站点服务；织境使用独立进程和持久数据目录。

## 构建与运行

小内存服务器应使用 GitHub Actions 在 Ubuntu 22.04 构建的 Linux x64 发布包，服务器仅下载、核对 SHA256、解包和运行。工作流为 `.github/workflows/zhijing-server-release.yml`，发布版本采用 `zhijing-server-<完整提交 SHA>`，不覆盖旧版本。构建和隔离 HTTP 验证均使用临时数据与禁止上游请求的测试配置；发布包不包含作品、数据库、API 配置或登录资料。

工作流或打包脚本的提交会自动触发构建；普通应用更新后，需在 GitHub Actions 中对 `master` 手动运行该工作流。构建发布包不会自动修改生产服务器。

发布包由 CI 使用 Node.js 24.19.0 和 pnpm 11.25.0 构建。运行服务器使用与该发布包匹配的 Linux x64 Node.js 24.19.0；安装成品发布包不需要 pnpm，也不执行依赖安装或生产编译。子路径与登录模式已写入发布包；服务器与本机根路径版本分别构建。

当前已安装运行的版本为 [`zhijing-server-0779e99576b776623669c812dd714f39bf3d09d0`](https://github.com/YinMinJ/yiaijia-textile-studio/releases/tag/zhijing-server-0779e99576b776623669c812dd714f39bf3d09d0)，构建记录为 GitHub Actions [37437197486](https://github.com/YinMinJ/yiaijia-textile-studio/actions/runs/37437197486)。下载其中的 `zhijing-linux-x64-0779e99576b776623669c812dd714f39bf3d09d0.tar.gz` 后，先核对 SHA256 为 `b31bcd57b913b12fb702d0a10cb95849ed1ad164d86d28e7cfbcfe521dce397d`，再解包到独立版本目录。入口、登录和美国中继均已验收；带鉴权模型列表、一张 2048 × 2048 实际图片及4张非首图的自动文案均已验证成功，手写首图文案保持不变。文案验收期间曾发生一次60秒超时，最小探测成功后手动重试通过，详见 `VERIFICATION.md`。

如需从源码重新构建，在 CI 或具备足够内存的独立 Linux x64 构建机上使用上述 Node.js 与 pnpm 版本。以下是外部构建步骤，不在共用的生产服务器上执行：

```sh
pnpm install --frozen-lockfile
APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_LOCAL_MODE=0 NEXT_PUBLIC_APP_BASE_PATH=/zhijing pnpm build
```

运行变量见 `deploy/zhijing.env.example`：`APP_URL` 只填写域名来源 `https://jxcymj.asia`，路径由 `NEXT_PUBLIC_APP_BASE_PATH` 配置。必须设置 `APP_LOCAL_MODE=0`，服务器通过邮箱和密码登录。服务仅监听 `127.0.0.1:3010`，由现有 HTTPS Nginx 反向代理。

`deploy/zhijing.service` 使用 `/opt/zhijing/current` 发布目录、`/opt/zhijing/runtime/bin/node` 和 `/var/lib/zhijing` 数据目录；部署时建立专用系统账户。Nginx 片段 `deploy/nginx-location.conf` 应加入现有域名 HTTPS 服务块，检查 `nginx -t` 后重载。先检查 3010 未被占用，再启动服务。

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

构建输出不提交源码仓库；CI 仅将经过检查的运行文件发布到 GitHub Releases。运行数据、API 密钥和登录资料不上传 GitHub。服务器发布使用新目录，持久数据独立保留；上线前备份门户首页、Nginx 配置和原有织境数据（若存在），并记录修改前后文件指纹。更新失败可切回上一发布目录及还原门户/Nginx备份。

验证包括匿名跳转登录、会话路径 `/zhijing`、Vue 脚本/CSS/字体/照片读取、作品保存回读、账户隔离、API 配置解密和退出失效。排版与 HTTP 验证不调用付费模型。

## B.AI 连通性

已为服务器独立账号导入现有加密 API 配置：`https://api.b.ai/v1`、`gpt-image-2`、`deepseek-v4.1-flash`、high、2K；未迁移本机作品或素材。最初上海服务器直连出现超时或 TLS 连接重置。用户随后明确授权使用美国服务器中继，并创建专用受限 SSH 账号；API Base URL 保持不变。

上海服务器使用专用系统用户运行 `bai-ssh-tunnel.service`，将 `127.0.0.1:18443` 经 SSH 转发到 `api.b.ai:443`。美国端专用账号仅接受业务服务器固定出口 IP 的专用密钥，`PermitOpen` 限制为 `api.b.ai:443`，禁止远程转发、TTY、agent、X11 和 shell/subsystem 会话，`MaxSessions=0`。客户端密钥位于受保护的 `/etc/zhijing-relay/`；`known_hosts` 固定从美国服务器控制台核对的主机密钥，并启用严格主机密钥检查。真实服务器 IP、登录凭据、主机密钥与指纹、私钥和 API 密钥均不写入公开文档或 GitHub。

上海 `bai-relay-connect.service` 以应用专用用户运行 `/opt/zhijing/relay/bai-relay-connect.mjs`，仅监听 `127.0.0.1:13128`，只接受目标严格等于 `api.b.ai:443` 的 HTTPS CONNECT，并转交本地 SSH 转发端口。该进程不终止 TLS；证书验证和 API 鉴权仍由应用完成。普通 HTTP 及其他 CONNECT 目标均被拒绝，不开放公共代理端口。

应用通过 `/etc/systemd/system/zhijing.service.d/bai-relay.conf` 在 Node 启动前设置 `NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY=http://127.0.0.1:13128`（包含小写变量），并将本机地址排除在代理之外。模板见 `deploy/bai-ssh-tunnel.service.example`、`deploy/bai-relay-connect.service` 与 `deploy/zhijing-bai-relay.conf.example`。两项中继服务已启用开机启动并处于 active；织境重启后健康检查通过。SSH 断线自动重连已实测恢复，其他域名的 CONNECT 返回 403，应用和两项中继端口均仅监听回环地址。

保留 TLS 校验的无鉴权请求经中继约 1.34 秒返回服务商 401，Node 环境代理请求也返回 401。随后浏览器带鉴权模型列表检测成功，找到 `gpt-image-2` 和 `deepseek-v4.1-flash`；高质量、2K 设置下实际生成的一张测试图已完整显示为 2048 × 2048。文案此前的聊天补全请求返回 `finish_reason=length`，被应用拒绝作为不完整结果使用；升级后改用 Responses 接口，最终在浏览器成功生成4张非首图的文案，首图标题与说明均保留原文。

Responses 文案验收曾出现一次60秒超时，原因未确定。随后最小直接探测在约2.947秒返回 HTTP 200，再手动重试页面请求成功。系统没有自动重试；遇到生成超时时，先核对服务商执行状态，再决定是否重试，以免重复生成或计费。

恢复时先检查 `systemctl status bai-ssh-tunnel bai-relay-connect zhijing` 与对应日志，再核对两个中继监听端口仅绑定回环地址。SSH 断线会自动重连；两项中继服务也可手动重启，再检查织境健康状态。不要在日志或排障命令输出中打印私钥或 API Key。

需要回退中继时，先确认下列 `.disabled` 备份名尚不存在，再将应用代理覆盖配置改名并重载、重启应用，最后停用中继服务：

```sh
mv /etc/systemd/system/zhijing.service.d/bai-relay.conf /etc/systemd/system/zhijing.service.d/bai-relay.conf.disabled
systemctl daemon-reload
systemctl restart zhijing
systemctl disable --now bai-relay-connect.service bai-ssh-tunnel.service
```

这会恢复织境原来的直接出站方式，门户入口、业务数据和已保存 API 配置不变；原上海直连故障可能再次出现。重新启用时恢复 `.conf` 文件，启用并启动两项中继服务，执行 `daemon-reload` 后重启织境。

中继只允许 `api.b.ai:443`。若服务商返回另一域名的图片下载 URL，或未来改用其他 API 服务商，该请求会被当前代理拒绝，需要先单独核实并配置对应访问路径；不能据模型列表可达就假定图片下载成功。B.AI [官方服务可用性说明](https://docs.b.ai/zh-Hans/llmservice/app-and-service-availability/)提供从 App 获取正式大陆 API Base URL 的另一途径；若改用该地址，应同步调整或停用当前固定域名代理，并重新验收，不猜测接口域名或关闭 TLS 校验。
