# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("NSC", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", subfontIndex=2))
pdfmetrics.registerFont(TTFont("NSCB", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", subfontIndex=2))

W,H = A4  # 595.27 x 841.89
NAVY = HexColor("#142D49"); ORANGE = HexColor("#ED8500"); WARM = HexColor("#F5F3EE")
GRAY = HexColor("#607080"); LIGHT = HexColor("#EAF0F5"); DARK = HexColor("#22303C")

OUT = "/home/hatch/workspace/your_files/qiaoge-product-promo/乔格体育俱乐部-产品宣传页.pdf"
LOGO_L = "/home/hatch/workspace/your_files/logo/IMG_9647-贵阳奥林匹克体育中心Logo.jpeg"
LOGO_R = "/home/hatch/workspace/your_files/logo/IMG_9645-乔格田径俱乐部Logo.jpeg"
C = "/home/hatch/workspace/qiaoge-promo/work/crops"

c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle("乔格体育俱乐部 产品宣传页")

# 背景
c.setFillColor(WARM); c.rect(0,0,W,H,stroke=0,fill=1)

# ===== 顶部 logo 栏（白底，双logo等高、原图不变形）=====
c.setFillColor(white); c.rect(0,H-76,W,76,stroke=0,fill=1)
lh=54; ly=H-76+16
# 左：奥体
iw_l = lh*1179/1151
c.drawImage(ImageReader(LOGO_L), 26, ly, width=iw_l, height=lh, preserveAspectRatio=True, mask='auto')
c.setFillColor(DARK); c.setFont("NSC",7.5)
c.drawString(26, H-76+5, "贵阳奥林匹克体育中心")
# 中：分隔竖线 + 英文
c.setStrokeColor(HexColor("#D8DEE4")); c.line(W/2, H-66, W/2, H-14)
c.setFillColor(GRAY); c.setFont("NSCB",10)
c.drawCentredString(W/2-58, H-44, "")
# 右：乔格
iw_r = lh*940/940
rx = W-26-iw_r
c.drawImage(ImageReader(LOGO_R), rx, ly, width=iw_r, height=lh, preserveAspectRatio=True, mask='auto')
c.setFillColor(DARK); c.setFont("NSC",7.5)
c.drawRightString(W-26, H-76+5, "乔格体育俱乐部")

# ===== 标题带（深蓝）=====
ty = H-76-86
c.setFillColor(NAVY); c.rect(0,ty,W,86,stroke=0,fill=1)
c.setFillColor(ORANGE); c.rect(0,ty,W,4,stroke=0,fill=1)
c.setFillColor(white); c.setFont("NSCB",27)
c.drawCentredString(W/2, ty+50, "乔格体育俱乐部")
c.setFont("NSC",11.5); c.setFillColor(HexColor("#CFE0EE"))
c.drawCentredString(W/2, ty+27, "QIAOGE ATHLETICS CLUB  ·  产品宣传")
c.setFont("NSC",9); c.setFillColor(ORANGE)
c.drawCentredString(W/2, ty+9, "从每一堂训练开始，陪伴每一步成长")

# ===== 主图 ======
hy = ty-196
c.drawImage(ImageReader(f"{C}/hero.jpg"), 0, hy, width=W, height=196)

# ===== 服务区 ======
sy = hy-16
c.setFillColor(NAVY); c.setFont("NSCB",14)
c.drawString(26, sy-12, "产品与服务")
c.setFillColor(ORANGE); c.rect(26, sy-17, 46, 2.5, stroke=0, fill=1)
c.setFillColor(GRAY); c.setFont("NSC",8.5)
c.drawRightString(W-26, sy-12, "运动员第一，成绩第二 · 按基础分层 · 按过程评估 · 在比赛中检验")

cards = [
    ("01", "初高中升学体育服务", "面向初高中阶段，围绕升学体育需求\n开展专项训练与阶段提升。"),
    ("02", "初中体育统考课程", "针对初中体育统考项目与要求，\n系统训练、节点测试、及时复盘。"),
    ("03", "高考四项", "100米 · 800米\n原地推铅球 · 立定三级跳远"),
    ("04", "体育单招", "100米 · 200米\n400米 · 800米"),
    ("05", "体适能提升", "发展速度、力量、协调与身体控制，建立规律训练习惯，提升综合体适能表现。"),
]
cw = (W-52-10)/2; chh = 62; gap=10
top = sy-28
for i,(num,title,desc) in enumerate(cards):
    if i<4:
        x = 26 + (i%2)*(cw+gap); y = top - (i//2)*(chh+gap) - chh
        wdt = cw
    else:
        x = 26; y = top - 2*(chh+gap) - chh; wdt = W-52
    c.setFillColor(white)
    c.roundRect(x, y, wdt, chh, 7, stroke=0, fill=1)
    c.setFillColor(ORANGE); c.setFont("NSCB",13)
    c.drawString(x+12, y+chh-24, num)
    c.setFillColor(NAVY); c.setFont("NSCB",12.5)
    c.drawString(x+44, y+chh-24, title)
    c.setFillColor(HexColor("#44515C")); c.setFont("NSC",9)
    lines = desc.split("\n")
    if i==4:
        c.drawString(x+44, y+16, desc)
    else:
        for j,ln in enumerate(lines):
            c.drawString(x+44, y+24-j*13, ln)

# ===== 教练团队 =====
cy = top - 3*(chh+gap) - 14
c.setFillColor(NAVY); c.setFont("NSCB",14)
c.drawString(26, cy-12, "核心教练团队")
c.setFillColor(ORANGE); c.rect(26, cy-17, 46, 2.5, stroke=0, fill=1)
coaches = [
    ("林教练", "400米专项", "400米个人最好成绩 49.4秒\n国家田径初级教练员"),
    ("肖教练", "800米专项", "800米个人最好成绩 1分54秒38\n800米国家二级运动员"),
    ("周教练", "100米专项", "100米个人最好成绩 11秒39\n中国田径协会D级教练员 · 国家田径初级教练员"),
]
cw3 = (W-52-20)/3; ch3=54
for i,(n,s,d) in enumerate(coaches):
    x = 26 + i*(cw3+10); y = cy-28-ch3
    c.setFillColor(NAVY); c.roundRect(x, y, cw3, ch3, 7, stroke=0, fill=1)
    c.setFillColor(white); c.setFont("NSCB",11.5)
    c.drawString(x+10, y+ch3-20, n)
    c.setFillColor(ORANGE); c.setFont("NSCB",9.5)
    c.drawString(x+58, y+ch3-20, s)
    c.setFillColor(HexColor("#CFE0EE")); c.setFont("NSC",7.6)
    for j,ln in enumerate(d.split("\n")):
        c.drawString(x+10, y+22-j*11.5, ln)

# ===== 照片墙 =====
py = cy-28-ch3-12
imgs = [f"{C}/g1.jpg", f"{C}/g4.jpg", f"{C}/g2.jpg", f"{C}/g3.jpg"]
caps = ["日常训练 · 学员集合", "俱乐部合影 · 梦想启航", "赛事实践 · 奖牌时刻", "达标系列赛 · 冠军领奖台"]
gw = (W-52-3*8)/4; gh=96
for i,(im,cap) in enumerate(imgs):
    x = 26 + i*(gw+8); y = py-gh
    c.drawImage(ImageReader(im), x, y, width=gw, height=gh)
    c.setFillColor(HexColor("#44515C")); c.setFont("NSC",7.5)
    c.drawCentredString(x+gw/2, y-11, cap)

# ===== 底部联系栏 =====
fy = py-gh-24-40
c.setFillColor(NAVY); c.rect(0,0,W,fy+40,stroke=0,fill=1)
c.setFillColor(ORANGE); c.rect(0,fy+40,W,3,stroke=0,fill=1)
c.setFillColor(white); c.setFont("NSCB",10.5)
c.drawCentredString(W/2, fy+22, "训练地点：贵阳奥林匹克体育中心及校园合作项目")
c.setFont("NSC",10); c.setFillColor(HexColor("#CFE0EE"))
c.drawCentredString(W/2, fy+5, "课程咨询：周教练  13096785017")

c.showPage(); c.save()
print("saved", OUT)
