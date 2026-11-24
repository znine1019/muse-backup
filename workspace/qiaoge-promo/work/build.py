# -*- coding: utf-8 -*-
from PIL import Image
import os

WDIR="/home/hatch/workspace/qiaoge-promo/work"
CROP=f"{WDIR}/crops"; os.makedirs(CROP, exist_ok=True)

def crop_to(src, name, ratio, y_bias=0.5, x_bias=0.5):
    im=Image.open(src).convert("RGB")
    w,h=im.size; r=w/h
    if r>ratio:  # too wide
        nw=int(h*ratio); x0=int((w-nw)*x_bias); box=(x0,0,x0+nw,h)
    else:
        nh=int(w/ratio); y0=int((h-nh)*y_bias); box=(0,y0,w,y0+nh)
    out=im.crop(box)
    out.save(f"{CROP}/{name}", quality=92)
    return f"{CROP}/{name}"

U="/home/hatch/workspace/user/files"
hero   = crop_to(f"{U}/39038FF2-43C0-4955-8450-36F6094E60BD-photo-2159DEBB-77D8-48C8-95F5-6E802BF8C891.jpg","hero.jpg", 595/196, y_bias=0.42)
gather = crop_to(f"{U}/FB5D6336-803B-428E-9E4D-9B16D661A2B5-photo-2E494D88-2D8F-4F45-82BF-3C7BB07FEE50.jpg","g1.jpg", 136/96, y_bias=0.45)
medal  = crop_to(f"{U}/EE207285-75B3-459A-B5F6-0B4AF4B48518-photo-1C73A30A-0071-4678-A83B-59936E60A758.jpg","g2.jpg", 136/96, y_bias=0.30)
podium = crop_to(f"{U}/BF21C7FA-EABD-46E1-A178-D2892C97F7E9-photo-0744C12E-8E56-43D8-8CDF-12F616F077FC.jpg","g3.jpg", 136/96, y_bias=0.35)
brand1 = crop_to(f"{WDIR}/brand_images/p01_x32_1706x1279.png","g4.jpg", 136/96, y_bias=0.45)
print(hero, gather, medal, podium, brand1)
