# dsh-git-branch-pill

在「对话状态」那一行（输入框下方的 composer dock）里加一枚胶囊，显示当前会话工作目录所在的 Git 分支。

```
（输入框）
  ⑂ 2 轮 17 步 · 226 tok/s   ▤ 3.8M tok · 缓存命中 99%   ⑂ feat/dock   ◔ 22%
                                                          ^^^^^^^^^^
                                                          新增的这一枚
```

## 行为

| 场景 | 展示 |
| --- | --- |
| 工作目录在 Git 仓库里 | `⑂ 分支名`（tooltip 里带完整路径） |
| 游离 HEAD | `⑂ 短 commit`，tooltip 说明是 detached |
| 工作目录不是 Git 仓库 / 目录不存在 | 不渲染，dock 保持原样 |
| 会话还没建（无 `cwd`） | 不渲染 |
| 分支名过长 | 省略号，最长 220px |

- 分支随**会话的 `cwd`** 走：用 worktree 工具切到新分支目录后，胶囊会跟着变。
- 刷新时机：窗口重新获得焦点、页面重新可见、以及可见状态下每 20 秒一次。
- 一次请求失败时保留上一次读数，绝不猜一个分支出来。

## 结构

```
dist/index.js   Host 半：注册鉴权路由 POST /api/git-branch，按路径缓存 4s
dist/client.js  浏览器半：往 conversation.composer.dock 注册 order=2 的条目
```

Host 半只跑只读命令（`symbolic-ref` / `rev-parse`），带 `GIT_OPTIONAL_LOCKS=0`，不碰工作区。
浏览器半从会话列表读 `cwd`，所以多个会话视图共用一份按路径的缓存，不会一次渲染跑一次 git。

## 安装

```bash
# 1) 装进 profile（registry 直接用包名；本地改代码时用 link:）
dsh plugin --profile web add dsh-git-branch-pill
# dsh plugin --profile web add link:/path/to/dsh-git-branch-pill

# 2) 包名会记进 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles，
#    bundle 自己的 cordis.patch.yml 声明 insert 行，用户层 patch 不用动

# 3) 浏览器刷新页面
```

新 bundle 由 HMR 组合进已运行的 profile；**改 Host 半的代码**之后需要重启 DSH
（或用插件页关/开一次）才会加载新的 JavaScript 世代，只刷新页面不够。

## 测试

```bash
node --test "test/*.test.mjs"
```

- `test/host.test.mjs`：真实临时仓库——普通分支、嵌套子目录、未提交首次 commit、游离 HEAD、
  非仓库目录、缓存与强制刷新、路由返回结构。
- `test/client.test.mjs`：模块加载契约、`conversation.composer.dock` 注册（id/order）、
  纯渲染函数在「无仓库读数据」「有分支」「游离 HEAD」三种输入下的输出。

## 卸载

```bash
dsh plugin --profile web remove dsh-git-branch-pill
```

再从 `dsh.profile.bundles` 里删掉 `dsh-git-branch-pill`。
