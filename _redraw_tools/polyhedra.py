"""通用凸多面体线画渲染器：给定三维顶点集合，自动求凸包、合并共面三角形为原始
多边形面，做背面剔除、画家算法排序、隐藏边虚线化，输出类似书中"灰面+白高光+
虚线隐藏边"风格的线画图（SVG）。

2026-08 修订：新增**逐面明暗**（face shading）。原来所有可见面都用同一个灰度
平涂，多面体看上去是一团糊，各个面分不出来。现在按"面法向 · 光源方向"给每个面
算一个亮度，朝向不同的面自然得到深浅不同的灰，立体感和原书扫描件一致。

向后兼容：函数签名只做「新增带默认值的关键字参数」，老调用方式全部照旧可用；
只是默认开启了 shade=True，渲染结果会从单色平涂变成带明暗（这正是本次要的效果）。
"""
import numpy as np
from scipy.spatial import ConvexHull
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgb
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.collections import PatchCollection

GRAY_FILL = "#c9c9c9"
GRAY_FILL2 = "#dcdcdc"
EDGE_COLOR = "#5a5a5a"
HIDDEN_COLOR = "#bdbdbd"

# 开启明暗时的面基色（接近白，靠阴影压出深浅），以及默认光源。
SHADE_BASE = "#f2f2f2"
# 光源方向写在**相机坐标系**里：(向右, 向上, 朝向观察者)。
# 默认为左上前方打光——与原书插图"左上白、右侧深"的习惯一致。
LIGHT_DIR = (-0.42, 0.52, 0.74)
# 最暗的面保留多少基色（环境光）。0.55 → 最暗约 #868686，最亮约 #f2f2f2。
SHADE_AMBIENT = 0.55


def merge_faces(vertices, tol=1e-4):
    hull = ConvexHull(vertices)
    eqs = hull.equations  # (a,b,c,d) with ax+by+cz+d=0, outward normal (a,b,c)
    simplices = hull.simplices
    normals = eqs[:, :3]
    groups = []  # list of (normal, set(vertex_idx))
    for tri, n in zip(simplices, normals):
        n = n / np.linalg.norm(n)
        placed = False
        for g in groups:
            if np.allclose(g[0], n, atol=1e-3):
                g[1].update(tri.tolist())
                placed = True
                break
        if not placed:
            groups.append([n, set(tri.tolist())])

    faces = []
    for n, idxs in groups:
        idxs = list(idxs)
        pts = vertices[idxs]
        centroid = pts.mean(axis=0)
        # local 2D frame on the face plane
        ref = np.array([1.0, 0.0, 0.0])
        if abs(np.dot(ref, n)) > 0.9:
            ref = np.array([0.0, 1.0, 0.0])
        u = np.cross(n, ref)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        angles = []
        for p in pts:
            d = p - centroid
            angles.append(np.arctan2(np.dot(d, v), np.dot(d, u)))
        order = np.argsort(angles)
        ordered_idx = [idxs[i] for i in order]
        faces.append((tuple(ordered_idx), n))
    return faces


def edges_from_faces(faces):
    edge_faces = {}
    for face_idx, (idxs, n) in enumerate(faces):
        m = len(idxs)
        for i in range(m):
            a, b = idxs[i], idxs[(i + 1) % m]
            key = (min(a, b), max(a, b))
            edge_faces.setdefault(key, []).append(face_idx)
    return edge_faces


def camera_frame(view):
    """由观察方向（由物体指向观察者）算出屏幕的 right/up 基向量。"""
    view = np.asarray(view, dtype=float)
    view = view / np.linalg.norm(view)
    ref = np.array([0.0, 0.0, 1.0])
    if abs(np.dot(ref, view)) > 0.95:
        ref = np.array([0.0, 1.0, 0.0])
    right = np.cross(ref, view)
    right /= np.linalg.norm(right)
    up = np.cross(view, right)
    return view, right, up


def light_to_world(light, right, up, view):
    """把相机坐标系下的光源方向 (右, 上, 朝向观察者) 换算到世界坐标。"""
    lx, ly, lz = light
    L = lx * np.asarray(right) + ly * np.asarray(up) + lz * np.asarray(view)
    return L / np.linalg.norm(L)


def shade_color(base, brightness, ambient=SHADE_AMBIENT):
    """base 为基色，brightness ∈ [0,1] 为 max(0, n·L)，返回压暗后的 RGB。"""
    r, g, b = to_rgb(base)
    f = ambient + (1.0 - ambient) * float(np.clip(brightness, 0.0, 1.0))
    return (min(1.0, r * f), min(1.0, g * f), min(1.0, b * f))


def render_faces(vertices, faces, ax, view=(1.0, -0.55, 0.55), scale=1.0,
                 fill=GRAY_FILL, edge_color=EDGE_COLOR, hidden_color=HIDDEN_COLOR,
                 lw=1.6, hidden_lw=1.1, highlight=None,
                 shade=True, light=LIGHT_DIR, ambient=SHADE_AMBIENT,
                 face_base=None, face_color_fn=None,
                 draw_hidden=True, cull=True, edge_faces=None):
    """用给定的面表（[(顶点下标序列, 外法向), ...]）渲染。

    face_color_fn(nsides, normal, idxs) -> 颜色 或 None
        返回该面的**基色**（仍会被明暗调制）；返回 None 用默认基色。
    """
    vertices = np.asarray(vertices, dtype=float)
    if edge_faces is None:
        edge_faces = edges_from_faces(faces)

    view, right, up = camera_frame(view)
    L = light_to_world(light, right, up, view) if shade else None
    base_default = face_base if face_base is not None else (SHADE_BASE if shade else fill)

    def proj(p):
        return np.array([np.dot(p, right), np.dot(p, up)]) * scale

    def depth(p):
        return np.dot(p, view)

    face_records = []
    draw_list = []
    for idxs, n in faces:
        n = np.asarray(n, dtype=float)
        n = n / np.linalg.norm(n)
        pts3 = vertices[list(idxs)]
        visible = (np.dot(n, view) > 1e-6) if cull else True
        d = np.mean([depth(p) for p in pts3])
        pts2 = [proj(p) for p in pts3]
        face_records.append((d, pts2, visible))
        if visible:
            base, amb = None, ambient
            if face_color_fn is not None:
                base = face_color_fn(len(idxs), n, idxs)
                # 允许返回 (基色, 该面自己的 ambient)：把某类面"提亮压平"，
                # 让它在明暗里依然一眼可辨（例如强调截角八面体的 6 个正方形）。
                if isinstance(base, (tuple, list)) and len(base) == 2 \
                        and isinstance(base[0], str):
                    base, amb = base[0], float(base[1])
            if base is None:
                base = base_default
            color = shade_color(base, float(np.dot(n, L)), amb) if shade else base
            draw_list.append((d, pts2, color))

    draw_list.sort(key=lambda r: r[0])
    for d, pts2, color in draw_list:
        ax.add_patch(MplPolygon(pts2, closed=True, facecolor=color,
                                edgecolor='none', zorder=2, antialiased=True))

    for (a, b), fidxs in edge_faces.items():
        vis_any = (not cull) or any(
            np.dot(np.asarray(faces[fi][1], dtype=float), view) > 1e-6 for fi in fidxs)
        p1, p2 = proj(vertices[a]), proj(vertices[b])
        if vis_any:
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=edge_color,
                    lw=lw, solid_capstyle='round', zorder=3)
        elif draw_hidden:
            # 隐藏边按书中惯例以虚线"透视"画在可见面之上（X光式画法），而非被遮挡
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=hidden_color,
                    lw=hidden_lw, dashes=(4, 3), zorder=2.5)

    if highlight is None:
        highlight = not shade  # 有了逐面明暗就不再需要那块白色高光圆斑
    if highlight:
        xs = [p[0] for _, pts2, vis in face_records if vis for p in pts2]
        ys = [p[1] for _, pts2, vis in face_records if vis for p in pts2]
        if xs:
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            r = max(max(xs) - min(xs), max(ys) - min(ys)) * 0.28
            hi = plt.Circle((cx - r * 0.5, cy + r * 0.6), r * 0.6,
                            color='white', alpha=0.35, zorder=4, linewidth=0)
            ax.add_patch(hi)

    ax.set_aspect('equal')
    ax.axis('off')
    return face_records


def render_polyhedron(vertices, ax, view=(1.0, -0.55, 0.55), scale=1.0,
                      fill=GRAY_FILL, edge_color=EDGE_COLOR, hidden_color=HIDDEN_COLOR,
                      lw=1.6, hidden_lw=1.1, highlight=None,
                      shade=True, light=LIGHT_DIR, ambient=SHADE_AMBIENT,
                      face_base=None, face_color_fn=None,
                      draw_hidden=True, center=True):
    vertices = np.asarray(vertices, dtype=float)
    if center:
        vertices = vertices - vertices.mean(axis=0)
    faces = merge_faces(vertices)
    return render_faces(vertices, faces, ax, view=view, scale=scale, fill=fill,
                        edge_color=edge_color, hidden_color=hidden_color,
                        lw=lw, hidden_lw=hidden_lw, highlight=highlight,
                        shade=shade, light=light, ambient=ambient,
                        face_base=face_base, face_color_fn=face_color_fn,
                        draw_hidden=draw_hidden)


def new_ax(figsize=(3.2, 3.2)):
    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')
    return fig, ax


def autoscale(ax, pad=0.15):
    ax.relim()
    ax.autoscale_view()
    xlim = ax.get_xlim()
    ylim = ax.get_ylim()
    dx = (xlim[1] - xlim[0]) * pad
    dy = (ylim[1] - ylim[0]) * pad
    ax.set_xlim(xlim[0] - dx, xlim[1] + dx)
    ax.set_ylim(ylim[0] - dy, ylim[1] + dy)
