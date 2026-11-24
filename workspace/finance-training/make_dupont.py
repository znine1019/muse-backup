# -*- coding: utf-8 -*-
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import matplotlib.font_manager as fm
for _f in ['/tmp/NotoSC-Regular.ttf','/tmp/NotoSC-Bold.ttf']: fm.fontManager.addfont(_f)
plt.rcParams['font.sans-serif'] = ['Noto Sans CJK SC']
plt.rcParams['axes.unicode_minus'] = False

fig, ax = plt.subplots(figsize=(11.5, 6.4), dpi=200)
ax.set_xlim(0, 115); ax.set_ylim(0, 64); ax.axis('off')

def box(x, y, w, h, title, value, fs=9.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.25,rounding_size=0.8',
                                fc='#f4f6f8', ec='#44546a', lw=1.0))
    ax.text(x + w/2, y + h - 2.6, title, ha='center', va='center', fontsize=fs, color='#222222')
    ax.text(x + w/2, y + h/2 - 2.2, value, ha='center', va='center', fontsize=fs + 0.5, weight='bold', color='#1f3864')

def link(x1, y1, x2, y2):
    ax.plot([x1, x2], [y1, y2], color='#8496b0', lw=1.0, zorder=0)

def tree(cx, company, roe, npm, tat, em, np_, rev, avga, avge, color_note):
    ax.text(cx, 62.5, company, ha='center', fontsize=12.5, weight='bold')
    box(cx - 11, 52, 22, 7.5, '净资产收益率 ROE', roe)
    y2 = 40
    items = [('销售净利率', npm), ('总资产周转率（次）', tat), ('权益乘数（平均）', em)]
    xs = [cx - 25.5, cx - 8.5, cx + 8.5]
    for (t, v), x in zip(items, xs):
        box(x, y2, 17, 7.5, t, v, fs=8.8)
        link(cx, 52, x + 8.5, y2 + 7.5)
    y3 = 27
    subs = [('净利润 ÷ 营业收入', np_), ('营业收入 ÷ 平均总资产', rev), ('平均总资产 ÷ 平均所有者权益', avge)]
    vals = [f'{np_}', f'{rev}', f'{avge}']
    subs2 = [('', f'平均总资产 {avga}'), ('', ''), ('', '')]
    detail = [f'净利润 {np_}', f'营业收入 {rev}', f'平均资产 {avga}\n平均权益 {avge}']
    for i, x in enumerate(xs):
        box(x, y3, 17, 9.5, ['净利润÷营业收入', '营业收入÷平均总资产', '平均总资产÷平均权益'][i], detail[i], fs=7.8)
        link(x + 8.5, y2, x + 8.5, y3 + 9.5)
    ax.text(cx, 21.5, color_note, ha='center', fontsize=9, color='#555555')

tree(28.5, '贵州茅台（2025年）', '34.40%', '50.53%', '0.56', '1.22',
     '853.10亿', '1688.38亿', '3013.90亿', '2479.85亿', 'ROE = 50.53% × 0.56 × 1.22')
tree(86.5, '五粮液（2025年）', '7.21%', '22.99%', '0.21', '1.46',
     '93.17亿', '405.29亿', '1891.18亿', '1292.88亿', 'ROE = 22.99% × 0.21 × 1.46')
ax.text(57.5, 12.5, '图5-1  2025年杜邦分析金字塔图（净资产收益率按净利润÷平均所有者权益计算，周转率、权益乘数均用平均余额）',
        ha='center', fontsize=9.5)
plt.tight_layout()
plt.savefig('/home/hatch/workspace/finance-training/build/dupont2025.png', bbox_inches='tight')
print('saved')
