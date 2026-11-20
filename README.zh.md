# dsh-dumate-provider · 百度搭子

[English](./README.md) | **简体中文**

DeepSeek Harness（DSH）原生插件：把**百度搭子 DuMate 账号**（免费 / Pro / Max 均可）接成 provider，模型进选择器，账号 / 余额 / 签到 / 模型开关进设置页。

- 22 个模型（DeepSeek V4 Pro、V4.1 Flash、Kimi K3 / K3.1、GLM-5.3、Qwen 3.8 Max、豆包 Seed 2.0、文心 4.5 VL、搭子自动档 L0–L2 …）
- Cookie 直连 `dumate-svc.baidu.com`，无本地网关、无额外端口
- 流式 / 工具调用 / 思考块；中文按 `StringDecoder` 解码，不跨包坏字
- 多账号池、冷却与故障转移；401 先刷 token 再判 Cookie 失效
- 每日北京时间自动签到（默认 09:17）、余额按包统计与阈值提醒、按模型开关
- 兼容 DSH **0.1.7 线**（0.1.7-rc.2 实测）、**0.2.0–0.2.2（含 rc.3）**；宿主侧不 import 任何 `@deepseek-ai/*`，无 peer 版本矩阵

## 安装

三种方式，任选其一。装完重启 DSH（新 provider 要在启动时注册进模型目录）。

**插件市场（推荐）**：DSH 侧边栏 → 插件市场 → 搜索「搭子」或「DuMate」→ 安装。
若市场里暂时搜不到，用下面两种直连方式。

**GitHub 直装**：

```bash
dsh plugin --profile web add github:JieZhiF/dsh-dumate-provider
```

**Release 直装**（不需要 npm 账号，推荐离线/受限网络）：

```bash
dsh plugin --profile web add https://github.com/JieZhiF/dsh-dumate-provider/releases/download/v1.5.0/dsh-dumate-provider-1.5.0.tgz
```

**npm 直装**（尚未发布到 npm；发布后可用）：

```bash
dsh plugin --profile web add dsh-dumate-provider
```

**本地目录**（开发用）：

```bash
dsh plugin --profile web add /home/viola/dumate-provider
```

或在 DSH 的 插件 → 添加插件 里填包目录。

## 手机端（dsh-go）

同一个包，两种界面。桌面 / 网页版走设置页；Android 的 **dsh-go** 走原生面板，装一次即可，不用两个包：

- 输入框上方的状态条：余额 + 今日是否已签到，点一下进面板
- 面板「百度搭子」：每个账号一条（状态 / 余额 / 签到），按钮有签到、启用停用、删除（二次确认）、刷新余额、全部签到
- 面板「模型开关」：22 个模型逐个开关，外加全部开 / 全部关
- 输入框上方的胶囊：**贴搭子Cookie**（读剪贴板 → 校验 → 存下）、**搭子签到**

手机上没有可用的 Chrome/Edge，所以「用浏览器登录」（CDP 读 httpOnly Cookie）只在桌面版可用。手机端的流程是：面板里点「打开登录页」（同一个 Baidu Cloud SSO 地址，登录后落在搭子的云产品页）→ 登录 → 复制 Cookie 请求头 → 回来粘贴，

- 复制整段 Cookie，点输入框上方的「贴搭子Cookie」（面板里也有「打开登录页」）。
  解析只挑 `BDUSS`，所以整段复制即可，不用自己找。

剪贴板只在你点胶囊那一下读一次。

原生半边只在引擎带 dsh-go 桥接时注册；网页版不受影响，两边读同一份状态（`$DSH_HOME/dumate-provider/state.json`），改一边另一边刷新即可看到。

## 使用

1. DSH → 设置 → 百度搭子 → 添加账号 → **用浏览器登录**：插件会起一个独立浏览器窗口，在里面登录百度账号即可自动加好。
   （也可以手动：DevTools → Application → Cookies → `www.dumate.cn`，复制 `Cookie` 请求头贴进来。）
2. 模型选择器里选「百度搭子」分组下的模型。

## 配置

设置页里可改：自动签到开关与时间（北京时间）、余额提醒开关与阈值、22 个模型各自开关、账号备注名 / 启用 / 删除 / 重新登录。

插件自己的状态存在 `$DSH_HOME/dumate-provider/state.json`（默认 `~/.dsh/dumate-provider/state.json`，权限 0600，含 Cookie）。不在 profile 的 `cordis.patch.yml` 里、也不在插件行的 `config` 里——模型开关改一次不该重启插件。

## API 接入（可选）

有企业版或自建 OpenAI 兼容端点时，设置页底部「API 接入」填 baseURL + Key，点「探测模型」自动拉模型列表；这些模型会出现在「百度搭子 · API」分组，与 Cookie 通道互不影响。

## 风险提示

本插件是**非官方接入**：直接调用搭子网页端接口，可能违反服务条款或触发风控，极端情况下账号可能被限制；积分按轮扣减、签到只是补充；插件只在本机保存 Cookie（0600），不保存密码。自行评估后使用。

企业版有官方 API（`api.dumate.cn`，API Key + SSE + 工具调用），开通后用通用 OpenAI 兼容 provider 更稳妥，见 [DETAIL](docs/DETAIL.zh.md)。

## 兼容与限制

- 个人账号均可用（免费 / Pro / Max）：搭子不给个人账号发 API Key，网页 Cookie 是唯一凭证；企业版 API Key 走内置的 `dumate-api` 通道。
- 积分按消息扣，签到只是补，不是无限额度。插件领取的是**网页端签到（每天 +200）**；PC 端另有 +300，需要在搭子桌面端自己领。
- 余额只统计 `product === "dumate"` 且有效的包，与官网 `totalPoints` 可能有口径差。
- 本版图片输入以 `[图片]` 占位（未做附件字节投影），文字与工具调用不受影响。

## 同类项目

这些项目从不同角度接同一个上游，本插件的若干设计参考过它们：

| 项目 | 做什么 |
|---|---|
| [wearetheone777/dumate2api](https://github.com/wearetheone777/dumate2api) | 搭子 / 千问办公 / TRAE Work / Qoder → OpenAI·Anthropic·Google 三协议网关 |
| [R227BOUT/magpie-dumate](https://github.com/R227BOUT/magpie-dumate) | 把搭子个人积分接入 Magpie；跨平台登录态、到期积分展示 |
| [RanceLee233/dumate-rance](https://github.com/RanceLee233/dumate-rance) | 跨平台登录态、模型发现与持久化 |
| [Alphaxiaoteng/dumate2api](https://github.com/Alphaxiaoteng/dumate2api) | 100% 兼容 OpenAI 格式的 2API 反代 |

其中 **magpie-dumate** 记在 README 里的排查方法（不按默认路径猜真实安装位置、
区分显示名与真实 API id、用新进程重新取 token 验证卸载独立性、"没测到不许写成通过"）
也直接影响了本插件的验证标准，在此致谢。

## 开发

```bash
npm run check   # 全部模块语法检查
npm test        # node:test 单测（cookie 归一化 / 消息映射 / usage 映射 / SSE 帧）
```

目录：`index.js`（Host apply）、`client.js`（设置页）、`src/`（adapter / wire / auth / api / pool / store / checkin / balance / routes / fence）、`locale/`（插件页元数据）、`docs/DETAIL*.md`（详情页）。

## 许可

MIT
