import numpy as np
from itertools import permutations

PHI = (1 + 5 ** 0.5) / 2


def _all_sign_perms(triples):
    """给定若干三元组，取其所有循环排列 + 所有正负号组合，去重后返回顶点数组。"""
    verts = set()
    for trip in triples:
        for perm in {trip, (trip[1], trip[2], trip[0]), (trip[2], trip[0], trip[1])}:
            xs = [perm[0]] if perm[0] == 0 else [perm[0], -perm[0]]
            ys = [perm[1]] if perm[1] == 0 else [perm[1], -perm[1]]
            zs = [perm[2]] if perm[2] == 0 else [perm[2], -perm[2]]
            for x in xs:
                for y in ys:
                    for z in zs:
                        verts.add((round(x, 6), round(y, 6), round(z, 6)))
    return np.array(sorted(verts), dtype=float)


def _all_perms_all_signs(triples):
    """给定若干三元组，取其全部 6 种排列 + 所有正负号组合，去重后返回顶点数组。"""
    verts = set()
    for trip in triples:
        for perm in set(permutations(trip)):
            xs = [perm[0]] if perm[0] == 0 else [perm[0], -perm[0]]
            ys = [perm[1]] if perm[1] == 0 else [perm[1], -perm[1]]
            zs = [perm[2]] if perm[2] == 0 else [perm[2], -perm[2]]
            for x in xs:
                for y in ys:
                    for z in zs:
                        verts.add((round(x, 6), round(y, 6), round(z, 6)))
    return np.array(sorted(verts), dtype=float)


def tetrahedron():
    return np.array([
        [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
    ], dtype=float)


def tetrahedron_upright():
    """顶点朝上、底面水平放置的正四面体（读者最容易辨认的"金字塔"朝向）。"""
    r = 2 * np.sqrt(2) / 3
    apex = (0, 0, 1)
    back = (0 * r, 1 * r, -1 / 3)
    fl = (-np.sqrt(3) / 2 * r, -0.5 * r, -1 / 3)
    fr = (np.sqrt(3) / 2 * r, -0.5 * r, -1 / 3)
    return np.array([apex, back, fl, fr], dtype=float)


def cube():
    pts = []
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                pts.append([x, y, z])
    return np.array(pts, dtype=float)


def octahedron():
    return np.array([
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ], dtype=float)


def icosahedron():
    return _all_sign_perms([(0, 1, PHI)])


def dodecahedron():
    cube_pts = cube()
    others = _all_sign_perms([(0, 1 / PHI, PHI)])
    return np.vstack([cube_pts, others])


def cuboctahedron():
    return _all_perms_all_signs([(1, 1, 0)])


def truncated_octahedron():
    return _all_perms_all_signs([(0, 1, 2)])


def truncated_cuboctahedron():
    a, b = 1 + np.sqrt(2), 1 + 2 * np.sqrt(2)
    return _all_perms_all_signs([(1, a, b)])


def truncated_icosahedron():
    base = [
        (0, 1, 3 * PHI),
        (1, 2 + PHI, 2 * PHI),
        (PHI, 2, 2 * PHI + 1),
    ]
    return _all_sign_perms(base)


def prism(n, height=1.0):
    """n 边正棱柱：上下两个正 n 边形。"""
    verts = []
    for z in (-height, height):
        for k in range(n):
            a = 2 * np.pi * k / n
            verts.append([np.cos(a), np.sin(a), z])
    return np.array(verts, dtype=float)


def antiprism(n, height=1.0):
    """n 边反棱柱：上下两个正 n 边形，彼此错开 pi/n。"""
    verts = []
    for k in range(n):
        a = 2 * np.pi * k / n
        verts.append([np.cos(a), np.sin(a), -height])
    for k in range(n):
        a = 2 * np.pi * k / n + np.pi / n
        verts.append([np.cos(a), np.sin(a), height])
    return np.array(verts, dtype=float)


def antiprism_regular(n):
    """棱长全部相等的 n 边反棱柱（外接圆半径 1，侧面为正三角形）。"""
    s = np.sin(np.pi / n) ** 2 - np.sin(np.pi / (2 * n)) ** 2
    return antiprism(n, height=np.sqrt(max(s, 1e-9)))


def rotation_to_z(axis):
    """返回把给定轴旋到 +z 的 3x3 旋转矩阵。"""
    a = np.asarray(axis, dtype=float)
    a = a / np.linalg.norm(a)
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(a, z)
    c = float(np.dot(a, z))
    if np.linalg.norm(v) < 1e-12:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def spin_z(angle):
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def orient(vertices, axis=(0, 0, 1), spin=0.0):
    """把 `axis` 指定的方向转成竖直向上（+z），再绕 z 轴自转 `spin` 弧度。

    用于给多面体挑一个"面/顶点朝上"的经典朝向，再配合俯视角度取景。
    """
    m = spin_z(spin) @ rotation_to_z(axis)
    return np.asarray(vertices, dtype=float) @ m.T


SOLID_BUILDERS = {
    'tetrahedron': tetrahedron_upright,
    'cube': cube,
    'octahedron': octahedron,
    'dodecahedron': dodecahedron,
    'icosahedron': icosahedron,
    'cuboctahedron': cuboctahedron,
    'truncated_octahedron': truncated_octahedron,
    'truncated_cuboctahedron': truncated_cuboctahedron,
    'truncated_icosahedron': truncated_icosahedron,
    'prism5': lambda: prism(5),
    'prism6': lambda: prism(6),
    'antiprism5': lambda: antiprism(5),
    'antiprism6': lambda: antiprism(6),
}
