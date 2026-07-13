# Data Lab 临时公网隧道运维说明

此方案用于自有域名启用前，让受邀标注者和复审者通过 HTTPS 访问本机 Data Lab。

## 当前结构

```text
审核人员浏览器
  -> ngrok HTTPS + Basic Auth
  -> 127.0.0.1:3000
  -> Next.js 生产服务
  -> 本机 SQLite / data/releases
```

应用数据不会上传到 ngrok，但所有远程操作都会直接修改本机 `prisma/dev.db`。

## 文件位置

- ngrok Traffic Policy：`%LOCALAPPDATA%\ngrok\hyacintech-policy.yml`
- 运行状态：`backups/tunnel-runtime/runtime.json`
- Next.js 日志：`backups/tunnel-runtime/next.*.log`
- ngrok 日志：`backups/tunnel-runtime/ngrok.*.log`
- 数据备份：`backups/tunnel-日期时间/`

上述备份和运行文件均被 Git 忽略。

## 启动

在项目根目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-data-lab-tunnel.ps1
```

脚本默认执行生产构建，然后启动 Next.js 和 ngrok。若刚刚已经完成构建：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-data-lab-tunnel.ps1 -SkipBuild
```

脚本结束时会打印公网 HTTPS 地址。ngrok 免费域名可能在重新启动后变化，以 `runtime.json` 或本次终端输出为准。

## 停止

同时停止隧道和由启动脚本创建的 Next.js：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-data-lab-tunnel.ps1
```

只停止隧道、保留本机应用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-data-lab-tunnel.ps1 -KeepApp
```

停止脚本只会终止运行状态文件中记录、且进程名匹配的进程。

## 发给审核人员的信息

分别通过安全渠道发送：

1. 本次 ngrok HTTPS 地址；
2. ngrok 外层 Basic Auth 用户名和密码；
3. 每个人自己的 Data Lab 用户名和初始密码；
4. `docs/data-lab-annotator-reviewer-guide.md`。

不要在同一条群消息中同时发送网址、外层密码和管理员凭据。不要向审核人员发送管理员账号。

首次访问 ngrok 免费域名时，浏览器可能出现 ngrok 官方提示页。核对域名后点击继续，随后输入外层 Basic Auth，再进入 Data Lab 登录页。

## 每日备份

开始工作前：

```powershell
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = ".\backups\daily-$timestamp"
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -LiteralPath .\prisma\dev.db -Destination "$target\dev.db"
Copy-Item -Recurse -LiteralPath .\data\releases -Destination "$target\releases"
```

审核期间不要运行 `db:migrate`、`db:seed`、`data-lab:init` 或 `data-lab:pilot`。

## 故障检查

本机应用：

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing
```

监听端口：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

ngrok 本地状态：

```powershell
Invoke-RestMethod http://127.0.0.1:4040/api/tunnels | ConvertTo-Json -Depth 5
```

查看错误日志：

```powershell
Get-Content .\backups\tunnel-runtime\next.err.log -Tail 100
Get-Content .\backups\tunnel-runtime\ngrok.err.log -Tail 100
```

## 安全要求

- 仅运行 `next build` + `next start`，不要公开 `next dev`；
- 保留 ngrok Basic Auth，不要只依赖随机网址；
- 每位参与者使用独立 Data Lab 账号；
- 外层密码不要与 Data Lab 密码相同；
- 人员退出项目后更换外层密码；
- 电脑睡眠、关机或网络中断都会使服务不可用；
- 不需要开放路由器端口或 Windows 入站防火墙规则；
- 域名可用后迁移到命名 Tunnel + 身份访问策略。
