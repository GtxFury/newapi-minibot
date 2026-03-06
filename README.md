# bil-bot

面向 BilAPI/NewAPI 的 Telegram Bot（MVP）：
- 充值下单（`/pay` 或 `/topup`）
- 订阅套餐（`/subplans` `/subbuy` `/mysub` `/subpref`）
- 兑换码充值（`/redeem`，底层 `/api/user/topup`）
- 管理 API Key（分组、启停、额度、过期、IP、模型限制）
- 查看账户与用量（`/me` `/usage`）
- 一键注册并绑定 Telegram（`/register`，可选）
- 菜单按钮化操作（选套餐下单、快速创建/删除 Key）
- Telegram Mini App（现代化 UI，支持深色/浅色模式）

## 1. 准备

1. Node.js >= 20
2. 在 Telegram 中通过 `@BotFather` 创建 bot，拿到 `BOT_TOKEN`
3. 准备 NewAPI/BilAPI 的访问令牌（Access Token）

## 2. 配置

```bash
cp .env.example .env
```

填写 `.env`：

- `BOT_TOKEN`：Telegram Bot Token
- `NEWAPI_BASE_URL`：后端地址（默认 `https://api.newapi.ai`）
- `DEFAULT_NEWAPI_TOKEN`（可选）：单用户默认 Token
- `DEFAULT_NEWAPI_USER_ID`（可选）：默认 NewAPI 用户 ID
- `ALLOW_RUNTIME_TOKEN_BIND`：是否允许用户 `/settoken` 绑定自己的 token
- `ENABLE_ONE_CLICK_REGISTER`：是否启用一键注册
- `REGISTER_ADMIN_TOKEN` / `REGISTER_ADMIN_USER_ID`：管理员凭证（用于后台建号）
- `REGISTER_USERNAME_PREFIX`：新用户名前缀（默认 `tg_`）
- `REGISTER_PASSWORD_SECRET`：密码派生密钥（可不填）
- `MINIAPP_ENABLED`：是否启用 Mini App（默认 `true`）
- `MINIAPP_HOST` / `MINIAPP_PORT`：Mini App 本地监听地址（默认 `0.0.0.0:8787`）
- `MINIAPP_URL`：Mini App 对外访问地址（建议配置公网 HTTPS，用于 Telegram 内嵌 WebApp）
- `MINIAPP_DEV_BYPASS_AUTH`：开发模式免 Telegram 验签（默认 `false`）

注意：`QuantumNous/new-api` 源码里用户接口默认要求同时携带：
- `Authorization: Bearer <access_token>`
- `New-Api-User: <user_id>`

## 3. 启动

```bash
npm install
npm run start
```

## 4. 主要命令

- `/start` 初始化并展示菜单
- `/settoken <token> <newapi_user_id>` 绑定个人凭证
- `/cleartoken` 清除个人凭证
- `/register` 一键注册并绑定 Telegram
- `/miniapp` 打开 Mini App
- `/me` 查看账户信息
- `/usage [days]` 查看用量（默认 30 天）
- `/subplans` 查看可购买订阅套餐
- `/mysub` 查看我的订阅和扣费策略
- `/subbuy <plan_id> [payment_method]` 购买订阅套餐（默认易支付）
- `/subpref <subscription_first|wallet_first|subscription_only|wallet_only>` 设置扣费策略
- `/subpref 优先钱包` 也支持中文别名（优先订阅/优先钱包/仅订阅/仅钱包）
- `/keys` 查看 API Keys
- `/keygroups` 查看 Key 分组统计
- `/keydetail <id>` 查看 Key 详情
- `/newkey <name> [quota] [expired_unix] [unlimited]` 创建 key
- `/keygroup <id> <group>` 设置 Key 分组
- `/keyrename <id> <name>` 修改 Key 名称
- `/keystatus <id> <enable|disable>` 启用/禁用 Key
- `/keyquota <id> <quota|unlimited>` 修改 Key 额度
- `/keyexpire <id> <unix|-1>` 修改 Key 到期时间
- `/keyips <id> <ip1,ip2|clear>` 设置 IP 白名单
- `/keymodels <id> <off|model1,model2>` 设置模型限制
- `/showkey <id>` 查看指定 key 明文
- `/delkey <id>` 删除 key
- `/redeem <code>` 兑换充值码
- `/topupinfo` 查看充值方式和最低充值等信息
- `/amount <amount>` 试算支付金额
- `/pay <amount> [payment_method]` 发起支付订单（不填方式会弹菜单）
- `/topup <amount> [payment_method]` 与 `/pay` 等价（兼容旧命令）
- `/mytopups` 查看个人充值记录

按钮化交互：
- 点击 `/menu` -> `📦 订阅套餐`，可直接按按钮选择套餐和系统支付方式（易支付）；
- 点击 `/menu` -> `🔑 API Keys`，可直接按钮快速创建或按条目删除；
- 点击 `/menu` -> `💳 充值中心`，可先选金额，再点支付方式下单。
- 点击 `/menu` -> `📱 Mini App`，进入一体化可视界面。

## 5. Mini App 说明

已内置前后端：
- 前端路径：`/miniapp/`
- API 路径：`/miniapi/*`
- 默认端口：`8787`

启动后会看到日志：
- `Mini App 已启动: http://127.0.0.1:8787/miniapp/`
- 若配置了 `MINIAPP_URL`，还会打印对外地址。

建议生产配置：
1. 反代到 HTTPS 域名（如 `https://your-domain/miniapp/`）
2. 在 `.env` 设置 `MINIAPP_URL=https://your-domain/miniapp/`
3. 在 Telegram `@BotFather` 中设置 WebApp/Menu Button 到同一 URL

开发调试（非 Telegram 客户端）：
1. `.env` 临时设 `MINIAPP_DEV_BYPASS_AUTH=true`
2. 浏览器打开 `http://127.0.0.1:8787/miniapp/?tg_user_id=<你的tg_id>`
3. 调试完成后务必关闭该开关

## 6. 一键注册说明

`/register` 流程：
1. bot 根据 Telegram 用户信息生成签名参数；
2. 先尝试 `/api/oauth/telegram/login`（已绑定则直接通过）；
3. 未绑定则调用管理员接口 `POST /api/user/` 创建用户；
4. 机器人代用户登录并调用 `/api/oauth/telegram/bind` 完成绑定；
5. 尝试生成 access token 并自动写回 bot 本地凭证。

自动命名规则：
- 优先使用 `tg_<telegram_username>`；
- 若冲突会自动尝试带后缀；
- 若 Telegram 未设置用户名，则回退为 `tg_<telegram_id>`。

注意事项：
- 你的 new-api 需开启 `TelegramOAuthEnabled` 并正确配置 `TelegramBotToken`；
- 对“已绑定 Telegram 的老用户”，仅开启 `ENABLE_ONE_CLICK_REGISTER=true` 即可自动登录并尝试下发 access token；
- 只有“未绑定用户自动建号”才需要 `REGISTER_ADMIN_TOKEN` 与 `REGISTER_ADMIN_USER_ID`；
- 若开启 Turnstile，`/api/user/login` 可能拦截机器人自动流程，此时需临时关闭 Turnstile 或增加后端专用注册接口。

## 7. 关于 NewAPI 文档对应

已对齐的核心接口路径：
- `GET /api/user/self`
- `GET /api/data/self?start_timestamp=&end_timestamp=`
- `GET /api/subscription/plans`
- `GET /api/subscription/self`
- `PUT /api/subscription/self/preference`
- `POST /api/subscription/epay/pay`
- `POST /api/subscription/stripe/pay`
- `POST /api/subscription/creem/pay`
- `GET /api/token/`
- `POST /api/token/`
- `DELETE /api/token/{id}`
- `POST /api/user/topup`（兑换码）
- `GET /api/user/topup/info`
- `GET /api/user/topup/self`
- `POST /api/user/amount`
- `POST /api/user/pay`

说明：不同站点（NewAPI 实例）对请求字段可能有定制差异。若你的 bilapi 字段名不同，可在 `src/newapiClient.js` 中按实际接口做适配。
