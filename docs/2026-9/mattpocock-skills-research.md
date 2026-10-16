# Matt Pocock `skills` 仓库调研

调研日期：2026-09-30
范围：仅查阅 [`mattpocock/skills`](https://github.com/mattpocock/skills) 的 README、插件清单和技能源码；以下外部链接固定到调研时的提交 `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`。

---

## 结论摘要

`mattpocock/skills` 不是应用框架或一个需要接入运行时的 npm 依赖；它是一组给编码代理使用的、可组合的工作流提示/规则（skills）。其目标是把真实工程中的需求澄清、领域建模、测试、排障、代码审查和交付等纪律固化为可重复调用的流程。作者明确将它定位为“小、易适配、可组合”，而不是替代理管整个开发过程的流程框架。[1]

它主要解决四类常见问题：先通过 grilling 对齐需求；用 glossary/ADR 建立共享术语；用 TDD 和有阶段门槛的排障获得反馈；以及用 deep-module 的设计和架构巡检控制代码复杂度。[1]

## 安装与首次配置

### Codex 与其他编码代理

在目标项目根目录执行：

```bash
npx skills@latest add mattpocock/skills
```

该安装器会交互式选择要安装的 skill 以及要安装到哪些编码代理；README 特别要求同时选择 `setup-matt-pocock-skills`。[1] 安装器写入的是项目中可编辑的普通 skill 文件，因此团队可以按自身流程修改；需要升级时，作者给出的命令是：

```bash
npx skills update
```

随后在每个仓库的代理会话中运行一次：

```text
/setup-matt-pocock-skills
```

这个初始化技能不是自动脚本：它先检查仓库，再让使用者确认 issue tracker、triage 标签和领域文档布局，最后才写入相应的 agent 配置和文档。[2]

### Claude Code

Claude Code 可使用官方 marketplace 的托管插件：

```bash
claude plugins install mattpocock-skills
```

或在会话中执行 `/plugin install mattpocock-skills`。这种方式安装完整、只读的技能包，且作者发布后自动更新。[1]

## 怎么用

README 将技能分为两类：

- **用户调用（user-invoked）**：需要主动输入对应命令，例如 `/grill-with-docs`、`/to-spec`、`/implement`；它们负责串联一个较完整的工作流。
- **模型调用（model-invoked）**：用户可点名，代理也可在任务匹配时采用，例如 `research`、`tdd`、`diagnosing-bugs`、`code-review`、`domain-modeling` 和 `codebase-design`；它们承载可复用的工程纪律。[1]

实务上可以按任务选最小组合：

| 场景 | 建议技能/流程 |
|---|---|
| 需求还不清楚、准备做较大改动 | `/grill-with-docs`；需要时再 `/to-spec`、`/to-tickets` |
| 有明确 spec/tickets，要实现 | `/implement`（其中在约定边界使用 TDD，结束前 code review） |
| 线上/疑难 bug | `diagnosing-bugs`，先建立可复现反馈，再最小化、假设、观测、修复和回归 |
| 想改善可维护性 | `/improve-codebase-architecture` 找候选点，再用 `codebase-design` 深化模块接口 |
| 需要查资料 | `research`，只使用高可信一手资料并将带引用的结论写入仓库 |

上述“大改动”的推荐链路（`grill-with-docs` → `to-spec` → `to-tickets` → `implement`，并由 TDD 和 code review 护航）来自仓库的 `ask-matt` 路由规则。[6]

技能的确切调用界面由所选代理决定；仓库文档用 `/skill-name` 表示显式调用。对于 Codex，应依当前客户端的技能调用约定点名同名技能。

## 重要注意事项

1. **二选一安装方式。** README 明确说明：Claude 的托管插件与 `npx skills` 文件安装器同时安装，会让每个 skill 出现两份。[1]
2. **Codex 目前走安装器，而非原生插件。** README 表明原生 Codex plugin 仍在 roadmap；不要把 Claude 插件命令当作 Codex 的安装方式。[1][3]
3. **先完成仓库初始化。** 多个工程流程依赖 setup 写入的 issue tracker、triage 标签、`GLOSSARY.md`/ADR 布局；跳过初始化会让这些流程缺少项目约定。[2]
4. **它是工作流辅助，不取代判断。** 例如 setup 会要求先探索、展示发现并经用户确认后再写配置；架构巡检也被定位为发现候选机会的 survey，而不是自动“拯救”旧代码库。[1][2]
5. **部分流程会改变外部或仓库状态。** `to-spec` 可以发布 issue，`to-tickets` 可以创建 tracker ticket，`implement` 的收尾流程包含提交；使用前应让团队明确授权和边界。[4]
6. **不要把 TDD 当成无条件开关。** 该技能要求先约定可测试的公共 seam，并以小的 red-green-refactor 垂直切片推进；测试基础薄弱时，先补足可运行的反馈回路。[5]

## 参考资料

1. [仓库 README：定位、安装、分类和技能目录](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/README.md)
2. [`setup-matt-pocock-skills` 源码：首次配置的检查、询问与写入规则](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/setup-matt-pocock-skills/SKILL.md)
3. [仓库 ADR 0002：以 Claude Code plugin 发布的决策记录](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/.agents/adr/0002-ship-as-a-claude-code-plugin.md)
4. [`to-spec`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-spec/SKILL.md)、[`to-tickets`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-tickets/SKILL.md) 和 [`implement`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement/SKILL.md) 的状态变更约定
5. [`tdd` 技能源码：测试 seam 与 red-green-refactor 约定](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd/SKILL.md)
6. [`ask-matt` 技能源码：按任务选择工程流程](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/ask-matt/SKILL.md)
