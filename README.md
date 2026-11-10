# claude-code-mods

Claude Code 的 mod（function-hooks 插件）合集。

## context-pane

在 Claude Code 终端对话区旁边常驻一个面板，实时显示当前会话的上下文占用，数字与 `/context` 一致：

```
已使用 6%                    62.1k / 1M
█████▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
■ Autocompact buffer        33k   3.3%
■ Messages                18.2k   1.8%
■ Memory files            17.8k   1.8%
■ Skills                   9.9k   1.0%
□ Free space             904.9k  90.5%
  MCP tools (deferred)   135.8k      —
▸ Memory files (3)
▸ MCP tools top 5
分项更新于 15:13:54
```

- 第一行总占用随每次用量变化更新（不额外调用接口）。
- 分项表在会话开始和每轮回答结束时重新统计，方式与 `/context` 相同；统计失败时退回本地估算，并标注"(估算)"。
- `deferred`（按需加载的工具 schema）不占窗口，单独列在最下面，不计百分比。
- `Memory files`、`MCP tools top 5` 可展开查看明细。
- 终端够宽且处于全屏布局时，面板自动停靠在右侧；没有自动出现时输入 `/context-pane` 打开。

### 安装

在终端里的 Claude Code 提示符下输入：

```
/plugin install context-pane --marketplace vaezc/claude-code-mods
```

之后按提示输入 `y` 添加 marketplace，再选择安装范围（user 即对所有项目生效）。

或者在 shell 里：

```
claude plugin install context-pane --marketplace vaezc/claude-code-mods
```

桌面端没有 `/plugin` 命令：点输入框旁的 +，选 Plugins，Add marketplace 填 `vaezc/claude-code-mods`，再 Add plugin。

### 要求

基于 Claude Code 2.1.322 的 mod API 编写和测试。该 API 处于 early access，后续版本可能变动。
