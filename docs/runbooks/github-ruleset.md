# GitHub `master` ruleset 运行手册

## 目标状态

为 `oliviaprel/fenshi-order-scheduling-mvp` 创建一个 Active branch ruleset，精确
匹配 `master`，并满足以下条件：

- 所有变更必须通过 pull request 合入，禁止直接 push；
- required approvals 为 **0**，不设置强制人工批准；
- 必须通过 GitHub Actions check
  `Quality, container smoke and security scan`；
- required status checks 使用 strict 模式，合并前分支必须与 `master` 保持最新；
- 禁止删除 `master` 和 force push；
- 不配置常规 bypass actor；紧急绕过只按 incident runbook 处理并留证。

GitHub 以 job 的 `name` 作为普通工作流的 required-check 名称，因此不要把上述
字符串替换成 workflow 文件名、job ID `quality` 或 master-only 的发布 job。发布
检查不能作为 PR 必需检查，因为它只在合并后的 master push 上运行。

## 应用步骤（仓库管理员执行）

1. 先推送一个测试 PR，让 `Quality, container smoke and security scan` 在仓库最近
   七天内至少成功一次。确认 PR Actions 中没有 `Publish image` run、GHCR 新 tag
   或 provenance。
2. 打开 **Settings → Rules → Rulesets → New branch ruleset**。
3. 名称填 `master-required-ci`，Enforcement status 选择 **Active**，Target branches
   仅 include `master`（也可以选择 Default branch，但必须确认默认分支就是
   `master`）。
4. 开启 **Restrict deletions**、**Block force pushes** 和
   **Require a pull request before merging**；Required approvals 填 `0`，不要开启
   code-owner review 或 last-push approval。
5. 开启 **Require status checks to pass**，添加
   `Quality, container smoke and security scan`，来源选择 GitHub Actions，并开启
   **Require branches to be up to date before merging**。
6. 不添加 bypass actor，保存 ruleset。检查是否还有旧 branch protection 或其他
   ruleset；GitHub 会叠加规则，旧规则中的 mandatory approval 也会继续生效。

## 验收与证据

用普通权限账号验证直接 push 到 `master` 被拒绝；再用测试 PR 验证未通过 required
check 时不可合并、check 通过后无需批准即可合并。合并后验证 `Publish image`
只运行一次，并按[腾讯云部署手册](deploy-tencent-cloud.md#github-镜像供应链发布)
完成公开 package、digest、SBOM、Trivy 和 attestation 检查。

将证据保存到 `docs/deployment-evidence/YYYY-MM-DD-stage-1/`：

- `ruleset.png`：Active 状态、`master` target 和全部规则；
- `required-check.png`：精确 check 名和 GitHub Actions 来源；
- `direct-push-rejected.txt`：不含 token 的拒绝输出；
- `rulesets.json`：管理员运行以下只读命令得到的 API 输出；
- `test-pr.md`：PR URL、head/base SHA、检查结果和合并结果；
- `trivy-high-critical.json`：从 master publish run 下载的完整（包括 unfixed）清单；
  required CI 只允许 `ignore-unfixed: true` 影响 gate，所有已有修复的
  High/Critical 仍必须失败。

```bash
gh api repos/oliviaprel/fenshi-order-scheduling-mvp/rulesets \
  > docs/deployment-evidence/YYYY-MM-DD-stage-1/rulesets.json
```

复核 JSON 中 ruleset 为 `active`、target 为 `branch`、condition 仅覆盖 `master`、
pull request 规则 approvals 为 `0`，且 required status check 的
`context` 精确为 `Quality, container smoke and security scan`。不要在证据文件中
保存 GitHub token、Actions secret 或数据库 URL。
