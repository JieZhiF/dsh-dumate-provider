# 百度搭子 DuMate

把「百度搭子（DuMate）个人会员」接进 DSH 的原生 provider：模型直接出现在模型选择器里，账号、余额、签到、模型开关都在设置页完成。

## 它做什么

- **模型进选择器**：注册 `dumate` provider，22 个模型（DeepSeek V4 Pro / V4.1 Flash、Kimi K3 / K3.1、GLM-5.3、Qwen 3.8 Max、豆包 Seed 2.0、文心 4.5 VL、搭子自动档 L0–L2 等）归在「百度搭子」分组下。
- **Cookie 直连**：网页 Cookie → token → `dumate-svc.baidu.com` 的 OpenAI 兼容接口，没有本地网关、没有额外端口、没有第二个进程。
- **流式 + 工具调用 + 思考**：SSE 用 `StringDecoder` 解析（中文不会跨包变乱码）；`tool_calls` 增量聚合成 `tool-calls` 块；`reasoning_content` 走思考块，不混进正文。
- **浏览器登录**：点「添加账号」→「用浏览器登录」，插件会起一个独立的 Chrome/Edge 窗口（不影响你正在用的浏览器），登录完成后用 DevTools 协议直接读 httpOnly 的 Cookie 并入库；也可以继续手动粘贴。
- **多账号**：账号池按优先级取用，失败进冷却并自动切下一个；401 先刷一次 token，Cookie 真失效才判死。
- **签到**：手动「立即签到」+ 每天北京时间自动签到（默认 09:17，可改），接口本身幂等，重复调用不会重复加分。**插件走网页端接口，每天 +200**；另外 300 是 PC 客户端的独立发放，需要在搭子桌面端自己领。
- **余额**：按包展示（会员包 / 签到发放 / 活动积分），提醒阈值可配（默认 1000 积分 ≈ 5 天网页端签到量），低于阈值在设置页显示横幅并在日志里 warning。
- **模型开关**：关掉的模型立刻从选择器消失；已锁定该模型的会话会得到可读报错。

## 怎么用

1. 在浏览器登录 <https://www.dumate.cn/app>（登录页会跳到 `login.bce.baidu.com`，这是百度云 SSO，正常现象）。
2. DevTools → Application → Cookies → `www.dumate.cn`，复制 `Cookie` 请求头（或整张表的 JSON）。
   关键 cookie 是 httpOnly 的 `BDUSS`，`document.cookie` 拿不到，必须这样复制。
3. DSH → 设置 → 百度搭子 → 添加账号，粘贴、验证并添加。
4. 到模型选择器里选「百度搭子」分组下的模型开始用。

## API 接入（可选）

设置页最下面有「API 接入」：填 baseURL（到 `/v1` 为止）+ API Key，点「探测模型」会请求 `GET {baseURL}/models` 自动填模型列表，也可以手写（每行 `id` 或 `id,显示名`）。保存后：

- 这些模型出现在模型选择器里单独的 **「百度搭子 · API」** 分组，不走 Cookie、不消耗搭子积分、也没有签到与余额；
- 支持任何 OpenAI 兼容端点（企业版、公司网关、自建中转都行）；
- 端点如果不是 OpenAI 兼容（例如只有 Agent 形态的接口），这个通道接不上，需要按它的协议改 `src/adapter-api.js`。

## 风险与免责声明

- **非官方接入**：本插件直接调用搭子网页端接口，不是百度官方提供的接入方式。可能与该服务的用户协议冲突，也可能触发风控；极端情况下账号可能被限制或封禁。请自行评估后使用。
- **凭据**：插件只保存网页 Cookie（本机 `$DSH_HOME/dumate-provider/state.json`，权限 0600），不保存密码。Cookie 等同于登录态，请不要分享这个文件。
- **额度**：积分按轮扣减、不同模型倍率不同；签到只是补充，不是无限额度。
- **不提供任何担保**：接口由第三方服务提供，随时可能变更或关闭；插件按「现状」提供，使用后果自负。

## 如果有官方 API

个人版没有 API；**企业版有**官方 Agent API（`api.dumate.cn`，API Key 鉴权，支持 SSE 与工具调用）。如果你能开通企业版，建议改用官方 API，而不是网页 Cookie：

- [企业版 API 快速开始](https://cloud.baidu.com/doc/Dumate/s/Mmtv8sxf3)
- [认证鉴权（创建 API Key）](https://cloud.baidu.com/doc/Dumate/s/umtl6r27w)
- [创建智能体](https://cloud.baidu.com/doc/Dumate/s/Gmtim7rk4)
- [企业版咨询入口](https://cloud.baidu.com/survey/dumate_enterprise_services.html)

在 DSH 里，官方 API 更适合用通用的 OpenAI 兼容 provider（`llm-pi-ai`）直接配 `baseURL + apiKey`，与本插件的 Cookie 通道互不干扰；两者可以并存，各管一类账号。

## 限制与口径

- 搭子个人版**没有 API Key、也没有 OAuth**，只能用网页 Cookie；这就是「浏览器登录」要自己起一个受控浏览器的原因——httpOnly cookie 只有 DevTools 协议读得到。Cookie 失效时重新走一次登录即可。
- 积分按消息消耗（不同模型倍率不同），签到每天补一点，**不是无限额度**。
- `quota_overview` 的原始 `totalPoints` 会把其它百度产品（如 comate）的包一起算进来；本插件只统计 `product === "dumate"` 且未过期的包，因此数字可能比官网小——这是口径差异，不是漏算。
- 图片输入：模型支持视觉时会以 `[图片]` 占位转发（本版未做附件字节投影），文字与工具调用不受影响。
- `dm-auto-model/*` 的档位编码在模型名里（如 `text.L1`），斜杠不是通道分隔，全名透传。

## 兼容

- DSH `0.1.7` 线（已在 `0.1.7-rc.2` 实测）、`0.2.0`–`0.2.2`（含 `0.2.2-rc.3`）；稳定版 `0.1.8`/`0.1.9` 发布后落在同一区间内。
- 宿主侧不 import 任何 `@deepseek-ai/*` 包：适配器按契约结构化实现，因此不需要 peer 版本矩阵。
