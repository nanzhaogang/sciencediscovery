# 安装配置页按钮圆角 — 修改前后对照

用于 PR 评审的截图存档。**修改前**取主干 `36476b0e`（本轮同步后的基线），**修改后**取特性分支 `fix/desktop-wizard-button-radius` 的构建；两边都在 Windows 上以 1600×1000 视口渲染，接口由 e2e 的确定性 mock 提供。

每个语言各两张，展示首次安装后的「配置你的研究工作区」步骤：

| 语言 | 修改前 | 修改后 |
| --- | --- | --- |
| 中文 | `before-zh.png` | `after-zh.png` |
| English | `before-en.png` | `after-en.png` |

修改点是该步骤底部的「跳过，用默认值 / 下一步」按钮（英文 `Skip and use the default / Next`）：原来使用 `border-radius: 999px` 的胶囊圆角，与随后登录页「使用华为账号登录」按钮的 6px 圆角不一致；现在统一为 6px。截图脚本只用于生成图片，不随分支提交；对应的样式断言在 `apps/desktop/src/styles/wizard.css`，本地渲染时读取到的计算值分别为 999px（改前）和 6px（改后）。
