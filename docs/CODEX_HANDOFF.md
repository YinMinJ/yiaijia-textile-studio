# 接手本地应用

用户明确要求本机运行，不使用 ChatGPT Sites 托管。保留 Next.js、Node.js SQLite 和本地 uploads，不恢复平台身份、D1/R2 或自动发布。

start-windows.cmd → scripts/start-local.ps1 → scripts/start-server.mjs。服务绑定 127.0.0.1:3000，APP_LOCAL_MODE=1、APP_URL=http://127.0.0.1:3000。stop-windows.cmd 校验进程后停服。

本机身份为 local-user，免登录分支验证 Host；写接口验证 Origin。不要把免登录服务绑定到公网或局域网。关闭模式后原独立账号认证仍在，但现有 local-user 作品不会自动转到其他账号。

data/ 是用户持久数据，不清空、不覆盖、不将真实密钥打包。代码修改后重新 pnpm build、重启，再浏览器验收。旧站私有数据未迁入。

当前为 Windows 实测版，结果见 VERIFICATION.md。开发环境已验证 B.AI 图片编辑与 DeepSeek 文案生成；新安装需填写自己的 API 配置。不要用模板图冒充 AI 结果。
