# -*- coding: utf-8 -*-
"""扫描 images/ 生成本地校对页 review.html（清单内嵌，避免 file:// 下 fetch 被拦）"""
import os, re, json, collections

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJ = r"D:\0-code\0-python\FourColorTheorem\proof\papers\《四色足矣：四色猜想是如何解决的》（Robin Wilson）"
IMG = os.path.join(PROJ, "images")

d = collections.defaultdict(dict)
for f in os.listdir(IMG):
    m = re.match(r'(fig-\d+)_?(.*)\.(jpg|jpeg|png|svg)$', f, re.I)
    if not m:
        continue
    fid, desc, ext = m.group(1), m.group(2), m.group(3).lower()
    d[fid]['svg' if ext == 'svg' else 'orig'] = f
    if desc:
        d[fid].setdefault('desc', desc)

items = []
for fid in sorted(d, key=lambda x: int(x.split('-')[1])):
    v = d[fid]
    items.append({
        "id": fid,
        "desc": v.get('desc', ''),
        "orig": v.get('orig', ''),
        "svg": v.get('svg', ''),
    })

manifest = json.dumps(items, ensure_ascii=False, separators=(',', ':'))

HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>《四色足矣》插图校对台</title>
<style>
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui,"Microsoft YaHei",sans-serif; background:#f4f4f2; color:#222; }
header { position:sticky; top:0; z-index:10; background:#2f3640; color:#fff; padding:8px 14px;
         display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
header h1 { font-size:15px; margin:0; font-weight:600; }
.stat { font-size:13px; opacity:.9; }
.stat b { color:#7bd88f; } .stat i { color:#ffcc66; font-style:normal; } .stat s { color:#aaa; text-decoration:none; }
button { font:inherit; padding:5px 12px; border:1px solid #999; background:#fff; border-radius:4px; cursor:pointer; }
button:hover { background:#eee; }
header button { background:#4a5568; color:#fff; border-color:#666; }
header button:hover { background:#5a6578; }
header button.on { background:#7bd88f; color:#222; border-color:#7bd88f; }

#bar { height:5px; background:#555; }
#bar > div { height:100%; background:#7bd88f; width:0; transition:width .2s; }

main { display:flex; height:calc(100vh - 52px); }
#list { width:210px; overflow-y:auto; background:#fff; border-right:1px solid #ddd; flex:none; }
#list div { padding:5px 9px; font-size:12px; cursor:pointer; border-bottom:1px solid #f0f0f0;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#list div:hover { background:#f0f4f8; }
#list div.cur { background:#dbe9f7; font-weight:600; }
#list div.ok { border-left:4px solid #4caf50; }
#list div.fix { border-left:4px solid #ff9800; }
#list div.todo { border-left:4px solid #ccc; }
#list div.nosvg { color:#999; }

#work { flex:1; display:flex; flex-direction:column; overflow:hidden; }
#pair { flex:1; display:flex; gap:8px; padding:8px; overflow:hidden; }
.pane { flex:1; display:flex; flex-direction:column; background:#fff; border:1px solid #ddd; overflow:hidden; }
.pane h2 { margin:0; font-size:12px; padding:4px 8px; background:#eee; border-bottom:1px solid #ddd; font-weight:600; }
.pane .box { flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; padding:6px; }
.pane img { max-width:100%; max-height:100%; object-fit:contain; cursor:zoom-in; }
.pane .none { color:#aaa; font-size:14px; }
#ctl { padding:8px 12px; background:#fff; border-top:1px solid #ddd; }
#title { font-size:13px; margin-bottom:6px; }
#title b { font-size:15px; }
#row { display:flex; gap:8px; align-items:flex-start; }
#cmt { flex:1; min-height:52px; font:inherit; font-size:13px; padding:5px; border:1px solid #bbb; border-radius:4px; resize:vertical; }
#btns { display:flex; flex-direction:column; gap:5px; flex:none; }
#pass { background:#4caf50; color:#fff; border-color:#4caf50; font-weight:600; }
#fix  { background:#ff9800; color:#fff; border-color:#ff9800; font-weight:600; }
#nav { display:flex; gap:5px; margin-top:5px; }
#nav button { flex:1; font-size:12px; padding:3px; }
.hint { font-size:11px; color:#888; margin-top:5px; }
#done { display:none; padding:10px 14px; background:#e8f5e9; border-top:2px solid #4caf50; font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>《四色足矣》插图校对台</h1>
  <span class="stat">共 <span id="n-all"></span> · 通过 <b id="n-ok">0</b> · 待改 <i id="n-fix">0</i> · 未审 <s id="n-todo">0</s></span>
  <button id="f-all" class="on">全部</button>
  <button id="f-todo">仅未审</button>
  <button id="f-fix">仅待改</button>
  <button id="f-nosvg">仅无新图</button>
  <button id="exp">导出 JSON</button>
  <button id="rst">清空进度</button>
</header>
<div id="bar"><div></div></div>

<main>
  <div id="list"></div>
  <div id="work">
    <div id="pair">
      <div class="pane"><h2>原图</h2><div class="box" id="box-o"></div></div>
      <div class="pane"><h2>新图（SVG）</h2><div class="box" id="box-n"></div></div>
    </div>
    <div id="ctl">
      <div id="title"></div>
      <div id="row">
        <textarea id="cmt" placeholder="修改意见（选「按意见调整」时填写，会写进导出的 JSON 供 AI 照着改）"></textarea>
        <div id="btns">
          <button id="pass">✓ 通过 (A)</button>
          <button id="fix">✎ 按意见调整 (S)</button>
          <div id="nav">
            <button id="prev">← 上一张</button>
            <button id="next">下一张 →</button>
          </div>
        </div>
      </div>
      <div class="hint">快捷键：← → 翻页 · A 通过 · S 记录意见 · 点图可放大（新标签页打开）</div>
    </div>
    <div id="done"></div>
  </div>
</main>

<script>
const ITEMS = __MANIFEST__;
const KEY = 'fct-review-v1';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) { state = {}; }
let filter = 'all', idx = 0;

const $ = s => document.querySelector(s);
const enc = f => 'images/' + encodeURIComponent(f);
const st = id => (state[id] && state[id].status) || 'todo';

function visible() {
  if (filter === 'todo')  return ITEMS.filter(x => st(x.id) === 'todo');
  if (filter === 'fix')   return ITEMS.filter(x => st(x.id) === 'fix');
  if (filter === 'nosvg') return ITEMS.filter(x => !x.svg);
  return ITEMS;
}

function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

function renderList() {
  const vis = visible();
  $('#list').innerHTML = vis.map((x, i) => {
    const s = st(x.id);
    const cls = [s === 'ok' ? 'ok' : s === 'fix' ? 'fix' : 'todo',
                 i === idx ? 'cur' : '', x.svg ? '' : 'nosvg'].join(' ');
    return `<div class="${cls}" data-i="${i}">${x.id} ${x.desc || ''}</div>`;
  }).join('');
  const cur = $('#list .cur'); if (cur) cur.scrollIntoView({block:'nearest'});
}

function renderStats() {
  let ok = 0, fx = 0;
  ITEMS.forEach(x => { const s = st(x.id); if (s === 'ok') ok++; else if (s === 'fix') fx++; });
  const todo = ITEMS.length - ok - fx;
  $('#n-all').textContent = ITEMS.length;
  $('#n-ok').textContent = ok; $('#n-fix').textContent = fx; $('#n-todo').textContent = todo;
  $('#bar > div').style.width = (100 * (ok + fx) / ITEMS.length) + '%';
  $('#done').style.display = todo === 0 ? 'block' : 'none';
  if (todo === 0) $('#done').innerHTML =
    `<b>全部审完了。</b>通过 ${ok} 张，待改 ${fx} 张 —— 点右上「导出 JSON」拿到修改清单交给 AI。`;
}

function render() {
  const vis = visible();
  if (!vis.length) {
    $('#box-o').innerHTML = '<span class="none">（该筛选下没有图）</span>';
    $('#box-n').innerHTML = ''; $('#title').textContent = ''; renderList(); renderStats(); return;
  }
  if (idx >= vis.length) idx = vis.length - 1;
  if (idx < 0) idx = 0;
  const x = vis[idx];
  $('#box-o').innerHTML = x.orig
    ? `<img src="${enc(x.orig)}" onclick="window.open(this.src)">`
    : '<span class="none">无原图</span>';
  $('#box-n').innerHTML = x.svg
    ? `<img src="${enc(x.svg)}" onclick="window.open(this.src)">`
    : '<span class="none">尚未重绘</span>';
  const s = st(x.id);
  const tag = s === 'ok' ? '<span style="color:#4caf50">● 已通过</span>'
            : s === 'fix' ? '<span style="color:#ff9800">● 待修改</span>'
            : '<span style="color:#999">○ 未审</span>';
  $('#title').innerHTML = `<b>${x.id}</b> ${x.desc || ''} &nbsp; ${tag} &nbsp;
     <span style="color:#888">(${idx + 1}/${vis.length})</span>`;
  $('#cmt').value = (state[x.id] && state[x.id].comment) || '';
  renderList(); renderStats();
}

function mark(status) {
  const vis = visible(); if (!vis.length) return;
  const x = vis[idx];
  const c = $('#cmt').value.trim();
  if (status === 'fix' && !c) { alert('请先填写修改意见'); $('#cmt').focus(); return; }
  state[x.id] = { status, comment: c, at: new Date().toISOString().slice(0, 19) };
  save();
  // 在「仅未审/仅待改」筛选下，本条会移出列表，停在原位即自动前进
  if (filter === 'all') idx = Math.min(idx + 1, ITEMS.length - 1);
  render();
}

$('#pass').onclick = () => mark('ok');
$('#fix').onclick  = () => mark('fix');
$('#prev').onclick = () => { idx--; render(); };
$('#next').onclick = () => { idx++; render(); };
$('#list').onclick = e => { const t = e.target.closest('[data-i]'); if (t) { idx = +t.dataset.i; render(); } };

[['f-all','all'],['f-todo','todo'],['f-fix','fix'],['f-nosvg','nosvg']].forEach(([id, f]) => {
  $('#' + id).onclick = () => {
    filter = f; idx = 0;
    document.querySelectorAll('header button').forEach(b => b.classList.remove('on'));
    $('#' + id).classList.add('on');
    render();
  };
});

$('#rst').onclick = () => {
  if (confirm('清空所有校对进度？不可恢复。')) { state = {}; save(); idx = 0; render(); }
};

$('#exp').onclick = () => {
  const fixes = [], approved = [], pending = [];
  ITEMS.forEach(x => {
    const s = state[x.id];
    const rec = { id: x.id, desc: x.desc, original: x.orig ? 'images/' + x.orig : null,
                  svg: x.svg ? 'images/' + x.svg : null };
    if (!s || s.status === 'todo') pending.push(rec);
    else if (s.status === 'ok') approved.push(x.id);
    else fixes.push(Object.assign(rec, { comment: s.comment, reviewed_at: s.at }));
  });
  const out = {
    project: '《四色足矣：四色猜想是如何解决的》插图重绘校对结果',
    exported_at: new Date().toISOString().slice(0, 19),
    summary: { total: ITEMS.length, approved: approved.length,
               needs_fix: fixes.length, pending: pending.length },
    instructions_for_ai:
      '请逐条处理 needs_fix。每条给出 svg（待修改文件）、original（原始扫描件，供对照）和 comment（人工修改意见）。' +
      '修改后覆盖同名 .svg，不要动 original，也不要修改 _redraw_tools/ 下的共享文件。',
    needs_fix: fixes,
    approved: approved,
    pending: pending.map(r => r.id)
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'review_result.json';
  a.click();
};

document.onkeydown = e => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft')  { idx--; render(); }
  if (e.key === 'ArrowRight') { idx++; render(); }
  if (e.key === 'a' || e.key === 'A') mark('ok');
  if (e.key === 's' || e.key === 'S') { $('#cmt').focus(); }
};

render();
</script>
</body>
</html>
"""

out = HTML.replace('__MANIFEST__', manifest)
dst = os.path.join(PROJ, "review.html")
with open(dst, "w", encoding="utf-8") as f:
    f.write(out)
print("written:", dst)
print("figures:", len(items), "| with svg:", sum(1 for i in items if i['svg']))
