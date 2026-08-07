#set page(paper: "a4", margin: (x: 2.4cm, y: 2.4cm), numbering: "1")
#set text(lang: "zh", region: "cn", size: 11pt,
  font: ("Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", "Times New Roman"))
#set par(justify: true, leading: 0.85em, first-line-indent: 2em)
#set heading(numbering: "1.")
#show heading: it => block(above: 1.3em, below: 0.8em)[#text(weight: "bold")[#it]]
#set math.equation(numbering: "(1)")

#align(center)[
  #text(17pt, weight: "bold")[Peaucellier–Lipkin 连杆机构画出精确直线的证明]
  #v(0.3em)
  #text(9.5pt)[反演变换 · 严格直线运动 · 1864 (Peaucellier) / 1871 (Lipkin)]
]
#v(0.6em)
#line(length: 100%, stroke: 0.5pt)

= 机构的描述

平面上取两个固定铰链 $O$ 与 $P$。机构由七根刚性杆组成：

- 两根等长的长杆 $O A$ 与 $O C$，长度均为 $a$；
- 四根等长的短杆 $A B, B C, C D, D A$，长度均为 $b$，它们围成一个菱形 $A B C D$（$B$ 与 $D$ 是一组对顶点，$A$ 与 $C$ 是另一组）；
- 一根曲柄 $P B$，长度为 $c$，且固定铰链之间满足
$ abs(P O) = abs(P B) = c. $

所有连接处都是自由转动的铰链。设 $a > b$。机构的自由度为 $1$：曲柄绕 $P$ 转动时，整个机构的位形被唯一决定（在同一分支上），而点 $D$ 描出一条#underline[精确的直线段]——不是近似，不含任何逼近误差。

= 关键引理：机构实现了一个反演变换

== $O, B, D$ 三点共线

#emph[证明。] 在菱形 $A B C D$ 中 $abs(A B) = abs(A D) = b$，故 $A$ 到 $B, D$ 等距；同理 $abs(C B) = abs(C D) = b$，故 $C$ 到 $B, D$ 等距。于是直线 $A C$ 是线段 $B D$ 的垂直平分线。

反过来，$B$ 与 $D$ 都到 $A, C$ 等距，所以直线 $B D$ 是线段 $A C$ 的垂直平分线。又因 $abs(O A) = abs(O C) = a$，点 $O$ 也落在 $A C$ 的垂直平分线上。由于 $A eq.not C$（菱形不退化），该垂直平分线唯一，故
$ O in "直线" B D, $
即 $O, B, D$ 三点共线。#h(1fr) $square$

== 乘积 $abs(O B) dot abs(O D)$ 是机构常数

#emph[命题。] 在机构的任何位形下，
$ abs(O B) dot abs(O D) = a^2 - b^2 =: k^2, $ <inv>
且 $B, D$ 始终位于 $O$ 的同一侧。

#emph[证明。] 设 $M$ 为两条对角线 $A C$ 与 $B D$ 的交点。由 2.1，$M$ 既是 $A C$ 的中点，也是 $B D$ 的中点，且 $A C perp B D$。

以 $M$ 为原点建立直角坐标系：取 $bold(e)_1$ 沿 $A C$ 方向，$bold(e)_2$ 沿 $B D$ 方向。记 $alpha = abs(M A) = abs(M C)$，则
$ A = (alpha, 0), quad C = (-alpha, 0), quad B = (0, beta), quad D = (0, -beta), $
其中 $beta = abs(M B) = abs(M D)$。由 2.1 知 $O$ 在直线 $B D$ 上，故可写 $O = (0, omega)$。

对直角三角形 $O M A$ 与 $B M A$ 分别用勾股定理：
$ omega^2 + alpha^2 = abs(O A)^2 = a^2, quad beta^2 + alpha^2 = abs(A B)^2 = b^2. $ <pyth>

现在把 $O B$ 与 $O D$ 看作同一条直线上的有向线段，其有向长度分别为 $beta - omega$ 与 $-beta - omega$。二者之积为
$ (beta - omega)(-beta - omega) = omega^2 - beta^2 = (a^2 - alpha^2) - (b^2 - alpha^2) = a^2 - b^2. $

因 $a > b$，该乘积为正，说明两个有向长度同号，即 $B$ 与 $D$ 在 $O$ 的同侧；取绝对值即得 @inv。注意 $alpha$ 被完全消去——它随机构变形而变化，而结论与之无关。#h(1fr) $square$

#block(inset: (left: 1em), stroke: (left: 1.5pt + rgb("#B23A18")))[
  @inv 的含义：$D$ 恰是 $B$ 关于圆心 $O$、半径 $k = sqrt(a^2 - b^2)$ 的#strong[圆的反演像]。菱形＋两长杆构成的这套装置（称为 Peaucellier 反演器）把反演变换机械地实现了出来。
]

= 定理：$D$ 的轨迹是直线

#block(inset: (left: 1em), stroke: (left: 1.5pt + rgb("#2F5D8C")))[
  #strong[定理。] 若 $abs(P O) = abs(P B) = c$，则曲柄端点 $B$ 在一个经过反演中心 $O$ 的圆上运动，此时 $D$ 沿一条垂直于直线 $O P$ 的定直线运动，该直线到 $O$ 的距离为 $ d = (a^2 - b^2) / (2c). $
]

#emph[证明。] 以 $O$ 为原点，射线 $O P$ 为 $x$ 轴正向。由 $abs(P O) = abs(P B) = c$，点 $B$ 在以 $P = (c, 0)$ 为心、$c$ 为半径的圆上，该圆经过原点 $O$，其在 $x$ 轴上的直径为 $2c$。

设 $theta$ 为 $arrow(O B)$ 与 $x$ 轴的夹角。因 $O$ 在该圆上而 $2c$ 是直径，由圆周角定理（直径所对圆周角为直角），
$ abs(O B) = 2c cos theta. $ <chord>

由 2.2，$D$ 在射线 $O B$ 上（同侧），故 $arrow(O D)$ 与 $x$ 轴夹角同为 $theta$，且
$ abs(O D) = k^2 / abs(O B) = (a^2 - b^2) / (2 c cos theta). $

于是 $D$ 的横坐标为
$ x_D = abs(O D) cos theta = (a^2 - b^2) / (2c) = d, $
与 $theta$ 无关。即无论曲柄转到何处，$D$ 恒落在定直线 $x = d$ 上。#h(1fr) $square$

== 直接的解析验证

也可以完全用坐标算一遍。参数化曲柄角 $phi$：
$ B(phi) = (c + c cos phi, space c sin phi), quad abs(O B)^2 = 2c^2 (1 + cos phi) = 4 c^2 cos^2 (phi/2). $

反演给出
$ D(phi) = k^2 / abs(O B)^2 dot B(phi) = k^2 / (4 c^2 cos^2(phi/2)) (c + c cos phi, space c sin phi). $

利用 $1 + cos phi = 2 cos^2(phi/2)$ 与 $sin phi = 2 sin(phi/2) cos(phi/2)$：
$ D(phi) = ( k^2/(2c), space k^2/(2c) tan(phi/2) ). $ <param>

横坐标恒为 $k^2\/(2c)$，纵坐标随 $phi$ 单调变化：这正是直线的参数方程。$square$

= 工作范围与退化位形

@param 表面上说 $D$ 走整条无穷直线，但杆长有限，机构有约束。

*菱形闭合条件。* 半对角线 $abs(M B) = abs(B D)\/2$ 不能超过边长 $b$，即 $abs(B D) <= 2b$。由 $abs(B D) = abs(O D) - abs(O B)$ 及 @inv，令 $r = abs(O B)$，
$ k^2 / r - r <= 2b arrow.l.r.double r^2 + 2 b r - (a^2 - b^2) >= 0 arrow.l.r.double r >= sqrt(b^2 + a^2 - b^2) - b = a - b. $

结合 @chord 的 $r = 2c abs(cos(phi/2))$，得到曲柄的可行摆角
$ abs(cos(phi/2)) >= (a - b) / (2c), quad "即" quad abs(phi) <= 2 arccos((a-b)/(2c)). $ <range>

*为什么曲柄不能整圈旋转。* 曲柄圆经过 $O$，当 $B arrow.r O$ 时 $abs(O B) arrow.r 0$，由 @inv 有 $abs(O D) arrow.r infinity$：反演把圆心附近映到无穷远。这正是"圆过反演中心 $arrow.r$ 像为直线"的代价，机构只能在 @range 给出的区间内往复摆动。@range 中的两个端点对应菱形被完全拉直（$A, B, C, D$ 共线）的奇异位形，此处机构失去确定性，实际设计中要留出余量。

*行程。* 在 @range 的端点处 $r = a - b$，$abs(O D) = k^2\/(a-b) = a + b$，故 $D$ 所描直线段的半长为
$ y_max = sqrt((a+b)^2 - d^2), quad d = (a^2 - b^2)/(2c). $

*为避免另一类奇异（$B$ 与 $D$ 重合，发生在 $abs(O B) = k$），* 通常取 $2c < sqrt(a^2 - b^2)$，使 $B$ 始终严格位于反演圆内部、$D$ 始终位于外部。附带的动画取 $a = 6, b = 3.6, c = 2$，此时 $k = 4.8 > 2c = 4$，且 $d = 5.76$，行程半长 $y_max = 7.68$。

= 历史注记

这一机构由法国工程师 Charles-Nicolas Peaucellier 于 1864 年提出，Lipman Lipkin 于 1871 年独立发现，是历史上第一个用铰链杆件实现#emph[精确]直线运动的解法——在此之前，瓦特（1784）等人的连杆只能给出近似直线。

Alfred Bray Kempe——也就是 1879 年给出四色定理著名"证明"（1890 年被 Heawood 指出漏洞，但其中的 Kempe 链方法至今仍是四色定理证明的核心工具）的那位律师兼数学家——在 1877 年的名篇 #emph[How to Draw a Straight Line: A Lecture on Linkages] 中普及了这个机构，题图正出于此。Kempe 本人在连杆理论上的核心贡献是 1876 年的#strong[普遍性定理]：任意平面代数曲线的有界弧段，都可以由某个铰链连杆机构的某个节点精确描出（"存在一个连杆机构可以签出你的名字"）。他给出的构造有缺陷，严格的证明由 Kapovich 与 Millson 在 2002 年完成。

// #v(0.5em)
// #line(length: 100%, stroke: 0.5pt)
// #text(9pt)[编译：`typst compile peaucellier-proof.typ`。若系统缺少思源/Noto 中文字体，请修改文件开头 `#set text(font: ...)` 一行。]
