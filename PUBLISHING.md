# 发布 / 投稿清单

本仓库已打包为可发布的状态。按下面三步走即可上架。

---

## 1. 推到 GitHub

```bash
cd dumate-provider
git remote add origin https://github.com/<你的账号>/dsh-dumate-provider.git
git branch -M main
git push -u origin main
```

推送前先在 GitHub 建一个**同名空仓库** `dsh-dumate-provider`（不要初始化 README，会和本地冲突）。

推完给仓库打上 topic（awesome-dsh-plugin 要求，也是很多目录的自动入口）：

```bash
# 用 gh CLI（若已登录）
gh repo edit <你的账号>/dsh-dumate-provider --add-topic dsh-plugin --add-topic dumate --add-topic baidu
```

或网页：仓库 → About（右侧齿轮）→ Topics 填 `dsh-plugin`。

> README / README.zh 里的安装命令已按账号 `JieZhiF` 写好；
> 若最终传到别的账号，把两个 README 里的 `JieZhiF` 换成实际账号再推。

---

## 2. 提交到插件市场索引（awesome-dsh-plugin）

市场「发现」页的数据源就是这份列表。提一个 **只加一个文件** 的 PR：

- 目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`
- 新文件路径：`data/plugins/<你的账号>__dsh-dumate-provider.yml`
  （文件名 = 你的 GitHub 账号 + 双下划线 + 仓库名，必须和 `url` 完全一致）

文件内容（账号 `JieZhiF`，与 README 一致）：

```yaml
url: https://github.com/JieZhiF/dsh-dumate-provider
name: JieZhiF/dsh-dumate-provider
category: model
description:
  en: 'Native Baidu DuMate provider for DeepSeek Harness: 22 models in the picker, cookie sign-in, multi-account failover, balance and daily check-in.'
  zh: '百度搭子 DuMate 原生 provider：22 个模型进选择器，Cookie 登录、多账号故障切换、余额查询与每日签到。'
icon: https://raw.githubusercontent.com/JieZhiF/dsh-dumate-provider/main/assets/icon-180.png
```

要点（对照官方贡献指南）：

- `category: model` —— 它是一个 provider/模型接入插件，归类正确。
- 描述含 `:` 必须加引号（上面已加）。
- 仓库需有 `dsh.bundle` manifest —— 本仓库 `package.json` 的 `dsh.bundle.patch` + 根目录 `cordis.patch.yml` 已满足。
- 仓库需有真实可运行代码 —— 有（`src/` + `index.js` + 27 个单测）。
- 仓库需创建满 1 天 —— 新建当天提会被 CI 挡，隔天再提即可。
- 描述必须属实：22 个模型、多账号故障切换、余额、每日签到，都与代码一致。

PR 合并后，README 列表会自动重新生成，无需手动改列表文件。

---

## 3.（可选）发到 npm

npm 不是前置条件，但发一份能让 `dsh plugin add dsh-dumate-provider` 直接可用。

```bash
cd dumate-provider
npm login          # 需要 npm 账号
npm publish        # package.json 已设 publishConfig.access=public
```

发布前自检（只打包 `files` 列出的内容，不含 test/HANDOFF）：

```bash
npm pack --dry-run
```

---

## 发布前自检（本机已跑过）

- [x] `npm run check` —— 全部模块语法通过
- [x] `npm test` —— 27 个单测全绿
- [x] `npm pack --dry-run` —— 只含 index/client/src/locale/docs/icon/assets/README/LICENSE/CHANGELOG/cordis.patch.yml
- [x] 全仓库与 git 历史无凭据泄露（BDUSS / sessionid / API key / cookie 明文均无）
- [x] `engines.dsh` 覆盖 0.1.7–0.2.2，`dshReleases` 14 项标注 compatible
- [x] 风险横幅 + 「个人版没有 API」提示 + 官方 API 文档链接齐备

## 版本号一致性

当前 `package.json` = **1.1.0**。若发 npm 与 GitHub 用同一版本，直接推即可；
若之后改动过代码，记得同步 `package.json`、`CHANGELOG.md` 顶部的版本条目。
