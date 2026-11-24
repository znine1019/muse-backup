# 头像处理说明

## 已包含：主头像静帧（2 张）

- `avatar-main.webp`：原文件 `workspace/avatars/avatar-1794472529008910959-0.webp`，172K，Finch 电影原版机器人，2026-11-12 用户选定的第 1 个方案。
- `avatar-darkmode.webp`：原文件 `workspace/avatars/avatar-1794472529008910959-0-darkmode.webp`，169K。

新号处理方法：在新号头像设置里上传 `avatar-main.webp` 作为头像，不要只放文件。头像是账号设置，不是复制文件就能生效的。

## 未包含：跳舞视频等全套生成文件

原号 `workspace/avatars/` 共约 69M，含 12 个跳舞视频相关文件（mp4 / webp，含带音频版），以及各候选方案的 option 图片。体积大、且新号头像系统会重新生成动效，本包只留了上面 2 张主静帧。

如需全套，请用户另外说一声，我再单独打包 `workspace/avatars/`，不要默认把 69M 都塞进迁移包。

候选方案原文件（未包含）：avatar-options-1794472252693024785-0-*.webp 等 12 张，2026-11-12 三轮候选。
