# muse-backup

周才翔的 Muse 每日全局备份同步仓库（私有），方便跨 agent 调用。

- 同步节奏：每天约 00:19（Asia/Shanghai）随每日迁移备份一起更新；邮件（QQ 邮箱 + Gmail）和 Google Drive 的备份照旧，这个仓库只是多一个去向。
- 内容：全局备份解开后的文件，与邮件主包/补包、Drive 全局包同一套范围。文件总清单见 `GLOBAL-MANIFEST.md`（含每个文件的大小和 SHA-256 前 16 位）。
- 大文件不在本仓库：全局包 zip（约 253 MB）、GPT 包 zip（约 28 MB）、ChatGPT 导出原始 zip（401 MB）超过 GitHub 单文件上限，只存 Google Drive「Muse 迁移备份」文件夹，链接在每日备份邮件正文里。
- 永远不上 GitHub 的内容：补包敏感源文件（含身份证号、电话、学号）、私钥、凭证、浏览器 profile/cookies。这些只留在邮件补包和 Drive 全局包里。图片等二进制文件也不走本仓库的文本同步，清单和哈希在 `GLOBAL-MANIFEST.md` 里可查。
- 超过同步单次上限的大文本文件（如 memory/memory.md 约 38 MB）会切分后同步，切分清单另行注明；未切分前以 Drive 全局包为准。

结构与本地一致：`root/` 是根级文件，`memory/` 是记忆库，`goals-live/` 是目标与定时任务定义，其余目录同名对应。
