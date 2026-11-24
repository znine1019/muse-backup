# -*- coding: utf-8 -*-
# 单位: 亿元
M = {  # 贵州茅台
 2022: dict(cash=582.74, tfa=0.0, nr=1.05, ar=0.21, pre=8.97, inv=388.24, ca=2166.11, cl=490.66, tl=495.63, ta=2545.01, eq=2049.38, cl_contract=154.72, rev=1241.00, cogs=100.93, op=878.80, tp=877.01, np=653.76, npat=627.17, ix=0.12, ocf=366.99, sales_cash=1406.92),
 2023: dict(cash=690.70, tfa=4.01, nr=0.14, ar=0.60, pre=0.35, inv=464.35, ca=2251.73, cl=486.98, tl=490.43, ta=2727.00, eq=2236.56, cl_contract=141.26, rev=1476.94, cogs=118.67, op=1037.09, tp=1036.63, np=775.21, npat=747.34, ix=0.13, ocf=665.93, sales_cash=1637.00),
 2024: dict(cash=592.96, tfa=2.49, nr=19.84, ar=0.19, pre=0.27, inv=543.43, ca=2517.27, cl=565.16, tl=569.33, ta=2989.45, eq=2420.11, cl_contract=95.92, rev=1708.99, cogs=137.89, op=1196.89, tp=1196.39, np=893.35, npat=862.28, ix=0.14, ocf=924.64, sales_cash=1826.45),
 2025: dict(cash=516.91, tfa=0.0, nr=0.0, ar=0.03, pre=0.07, inv=614.27, ca=2525.19, cl=496.10, tl=498.76, ta=3038.35, eq=2539.59, cl_contract=80.07, rev=1688.38, cogs=148.92, op=1148.09, tp=1147.55, np=853.10, npat=823.20, ix=0.29, ocf=615.22, sales_cash=1839.90),
}
W = {  # 五粮液 (tfa 无列示按0; nr 2023 缺失按0仅影响应收口径, 本计算应收周转只用应收账款)
 2022: dict(cash=923.58, tfa=0.0, nr=1.20, ar=0.36, pre=1.36, inv=159.81, ca=1375.66, cl=357.59, tl=361.25, ta=1528.12, eq=1166.87, cl_contract=123.79, rev=739.69, cogs=181.78, op=371.74, tp=371.04, np=279.70, npat=266.90, ix=0.48, ocf=244.31),
 2023: dict(cash=1154.56, tfa=0.0, nr=0.0, ar=0.43, pre=1.69, inv=173.88, ca=1471.82, cl=326.83, tl=330.84, ta=1654.33, eq=1323.49, cl_contract=68.64, rev=832.72, cogs=201.57, op=420.04, tp=419.13, np=315.21, npat=302.11, ix=0.12, ocf=417.42),
 2024: dict(cash=1273.99, tfa=0.0, nr=0.10, ar=0.37, pre=1.45, inv=182.34, ca=1657.83, cl=510.27, tl=518.57, ta=1882.52, eq=1363.95, cl_contract=116.90, rev=891.75, cogs=204.61, op=442.00, tp=441.63, np=331.93, npat=318.53, ix=0.40, ocf=339.40),
 2025: dict(cash=1270.14, tfa=0.0, nr=0.05, ar=0.38, pre=1.95, inv=200.65, ca=1647.52, cl=673.52, tl=678.04, ta=1899.84, eq=1221.81, cl_contract=134.60, rev=405.29, cogs=91.02, op=122.51, tp=121.99, np=93.17, npat=89.54, ix=0.29, ocf=297.06),
}
def ratios(D, name):
    print(f"===== {name} =====")
    for y in (2023, 2024, 2025):
        d, p = D[y], D[y-1]
        avg = lambda k: (d[k]+p[k])/2
        cr = d['ca']/d['cl']; qr = (d['ca']-d['inv'])/d['cl']; cashr = (d['cash']+d['tfa'])/d['cl']
        dr = d['tl']/d['ta']*100; em = d['ta']/d['eq']
        ebit = d['tp']+d['ix']; ic = ebit/d['ix'] if d['ix'] else float('inf')
        gm = (d['rev']-d['cogs'])/d['rev']*100; opm = d['op']/d['rev']*100; npm = d['np']/d['rev']*100
        roa = d['np']/avg('ta')*100; roe = d['np']/avg('eq')*100
        art = d['rev']/avg('ar') if avg('ar') else float('inf')
        invt = d['cogs']/avg('inv'); tat = d['rev']/avg('ta')
        grev = (d['rev']/p['rev']-1)*100; gta = (d['ta']/p['ta']-1)*100; gop = (d['op']/p['op']-1)*100
        geq = (d['eq']/p['eq']-1)*100; keep = d['eq']/p['eq']*100
        em_avg = avg('ta')/avg('eq')
        print(f"{y}: 流动{cr:.2f} 速动{qr:.2f} 现金{cashr:.2f} 资产负债率{dr:.2f}% 权益乘数{em:.2f} 利息保障{ic:,.0f}倍")
        print(f"     毛利率{gm:.2f}% 营业利润率{opm:.2f}% 净利率{npm:.2f}% ROA{roa:.2f}% ROE{roe:.2f}%")
        print(f"     应收周转{art:,.1f}次 存货周转{invt:.3f}次 总资产周转{tat:.3f}次")
        print(f"     增长: 收入{grev:.2f}% 总资产{gta:.2f}% 营业利润{gop:.2f}% 权益{geq:.2f}% 资本保值增值率{keep:.2f}%")
        print(f"     杜邦: 净利率{npm:.2f}% x 总资产周转{tat:.4f} x 平均权益乘数{em_avg:.4f} = ROE {npm/100*tat*em_avg*100:.2f}% (直接{roe:.2f}%)")
ratios(M, "贵州茅台"); ratios(W, "五粮液")
print("===== 茅台历年资产负债率 2016-2025 =====")
hist = {2016:(1129.35,370.36,758.99),2017:(1346.10,385.90,960.20),2018:(1598.47,424.38,1174.08),2019:(1830.42,411.66,1418.76),2020:(2133.96,456.75,1677.21),2021:(2551.68,582.11,1969.58),2022:(2545.01,495.63,2049.38),2023:(2727.00,490.43,2236.56),2024:(2989.45,569.33,2420.11),2025:(3038.35,498.76,2539.59)}
prev=None
for y in sorted(hist):
    a,l,e = hist[y]
    line=f"{y}: {l/a*100:.2f}%"
    if prev:
        pa,pl,pe=prev; line += f"  较上年{(l/a-pl/pa)*100:+.2f}pp (负债{(l/pl-1)*100:+.1f}%, 权益{(e/pe-1)*100:+.1f}%)"
    print(line); prev=(a,l,e)
print("===== 2016->2025 分解 (顺序替代: 先负债后权益) =====")
a0,l0,e0 = hist[2016]; a1,l1,e1 = hist[2025]
r0=l0/a0*100; r_mid=l1/(l1+e0)*100; r1=l1/a1*100
print(f"2016比率{r0:.2f}%  仅负债变(权益不变)时{r_mid:.2f}% (负债因素{r_mid-r0:+.2f}pp)  实际2025 {r1:.2f}% (权益因素{r1-r_mid:+.2f}pp)  总变化{r1-r0:+.2f}pp")
print(f"负债 370.36->498.76 (+{(498.76/370.36-1)*100:.1f}%), 权益 758.99->2539.59 (+{(2539.59/758.99-1)*100:.1f}%), 资产 1129.35->3038.35 (+{(3038.35/1129.35-1)*100:.1f}%)")
print("===== 茅台营运补充 =====")
for y in (2023,2024,2025):
    d=M[y]
    print(f"{y}: 销售收现/营收 {d['sales_cash']/d['rev']:.3f}, 经营现金流/净利润 {d['ocf']/d['np']:.3f}, 货币资金占总资产 {d['cash']/d['ta']*100:.1f}%, 存货占总资产 {d['inv']/d['ta']*100:.1f}%")
