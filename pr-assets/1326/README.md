# Review captures for PR #1326 (temporary branch)

These files are not part of the product tree. They exist on the throwaway
`pr-1326-assets` branch so the pull request description can render them inline,
and the branch should be deleted once #1326 is merged or closed.

| file | window | panel | what it shows |
| --- | --- | --- | --- |
| `01-zh-379-before.png` | 1024px | 379px | base `login.css`: the zh headline wraps |
| `02-zh-379-after.png` | 1024px | 379px | this branch: one line |
| `03-zh-340-before.png` | 919px | 340px | base: the wrap at the clamp floor |
| `04-zh-340-after.png` | 919px | 340px | this branch: one line at the floor |
| `05-en-710-before.png` | 1920px | 710px | base: uneven English break |
| `06-en-710-after.png` | 1920px | 710px | this branch: two balanced lines |
| `07-flow-before.png` | app window | — | packaged Windows build, empty catalog: entry page, `自定义模型` tab |
| `08-flow-after.png` | app window | — | same build after HUAWEI sign-in: workspace, credits model pill |

The four tagline pairs are headless Chromium at DPR 1, same markup and same
dictionary string, base CSS (`591e9f47`) versus this branch, column pinned by the
page width to `clamp(340px, 37vw, 710px)`.
