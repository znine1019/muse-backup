# 切分索引：memory/bank/reflections.md

- 原文件：memory/bank/reflections.md
- 原文件大小：4244273 字节
- 原文件 SHA-256：5a7484e2df282a19e933d1c993840cb0b8f711ca58765e567dc9413a2afe604b
- 块数：3（每块 <= 2000000 字节，按 UTF-8 边界切分）
- 块清单：part-000（1999998 字节）, part-001（2000000 字节）, part-002（244275 字节）

拼回方法（在仓库根目录执行）：

```sh
cat memory/bank/reflections.md.parts/part-* > memory/bank/reflections.md
```

拼回后用上面的 SHA-256 校验完整性。
