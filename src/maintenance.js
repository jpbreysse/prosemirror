/**
 * Maintenance Dashboard
 *
 * Fetches all documents that contain a maintenanceBlock, parses their tasks
 * and BOM trees, then renders:
 *   • Month navigator + summary stats
 *   • Overdue banner (always visible when tasks are overdue)
 *   • Per-machine cards showing:
 *       - SVG component tree (BOM) with nodes coloured by task status
 *       - Task list filtered to the selected month (+ overdue)
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function taskStatus(task) {
  if (task.status === "done") return "done";
  if (!task.scheduled_date)   return "planned";
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(task.scheduled_date);
  if (d < today) return "overdue";
  const soon = new Date(today); soon.setDate(soon.getDate() + 14);
  return d <= soon ? "upcoming" : "planned";
}

const STATUS_LABEL = { done:"Done", overdue:"Overdue", upcoming:"Soon", planned:"Planned" };
const STATUS_CLASS = { done:"st-done", overdue:"st-overdue", upcoming:"st-upcoming", planned:"st-planned" };

const NODE_COLORS = {
  none:     { fill:"#f4f4f5", stroke:"#d1d5db", text:"#9ca3af" },
  planned:  { fill:"#dbeafe", stroke:"#3b82f6", text:"#1d4ed8" },
  upcoming: { fill:"#fef9c3", stroke:"#eab308", text:"#854d0e" },
  overdue:  { fill:"#fee2e2", stroke:"#ef4444", text:"#991b1b" },
  done:     { fill:"#dcfce7", stroke:"#22c55e", text:"#166534" },
};

// ── Parse helpers ──────────────────────────────────────────────────────────────

function extractBlocks(docContent, type) {
  const blocks = docContent?.content ?? [];
  return blocks.filter(b => b.type === type);
}

function parseMaintDoc(row) {
  const blocks  = row.content?.content ?? [];
  const mBlocks = blocks.filter(b => b.type === "maintenanceBlock");
  const bBlocks = blocks.filter(b => b.type === "bomBlock");
  return {
    id:    row.id,
    title: row.title || "Untitled",
    tasks: mBlocks.flatMap(b => b.attrs?.tasks ?? []),
    bom:   bBlocks[0]?.attrs?.tree ?? null,
  };
}

function tasksForMonth(tasks, year, month) {
  return tasks.filter(t => {
    if (!t.scheduled_date) return false;
    const d = new Date(t.scheduled_date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

function allOverdue(tasks) {
  return tasks.filter(t => taskStatus(t) === "overdue");
}

// ── SVG Tree ───────────────────────────────────────────────────────────────────

const LEAF_H  = 34;   // vertical space per leaf node
const DEPTH_W = 130;  // horizontal space per depth level
const PAD     = 18;
const R       = 13;   // node circle radius

function maxDepth(node) {
  if (!node.children?.length) return 0;
  return 1 + Math.max(...node.children.map(maxDepth));
}

function assignLeafIndices(node, counter = { n: 0 }) {
  const children = node.children ?? [];
  if (!children.length) {
    node._leaf = counter.n++;
  } else {
    node._leaf = null;
    children.forEach(c => assignLeafIndices(c, counter));
  }
  return counter.n;
}

function assignPositions(node, depth) {
  node._x = PAD + depth * DEPTH_W;
  const children = node.children ?? [];
  children.forEach(c => assignPositions(c, depth + 1));
  if (node._leaf !== null && node._leaf !== undefined) {
    node._y = PAD + node._leaf * LEAF_H;
  } else if (children.length) {
    node._y = (children[0]._y + children[children.length - 1]._y) / 2;
  } else {
    node._y = PAD;
  }
}

function getNodeTaskStatus(node, tasks) {
  const matches = tasks.filter(t =>
    (t.component_id && t.component_id === node.id) ||
    t.component_name?.toLowerCase() === node.name?.toLowerCase()
  );
  if (!matches.length) return "none";
  const statuses = matches.map(taskStatus);
  if (statuses.includes("overdue"))  return "overdue";
  if (statuses.includes("upcoming")) return "upcoming";
  if (statuses.every(s => s === "done")) return "done";
  return "planned";
}

const SENSOR_RING = {
  alert:   { stroke: "#ef4444", width: 2,   cls: "sensor-ring-alert"   },
  warning: { stroke: "#f59e0b", width: 1.5, cls: "sensor-ring-warning" },
  ok:      { stroke: "#22c55e", width: 1,   cls: "sensor-ring-ok"      },
};

function buildSvg(bom, tasks, sensorReadings = new Map()) {
  if (!bom) return "";

  // Deep clone so we don't mutate the source
  const tree = JSON.parse(JSON.stringify(bom));

  const leafCount = assignLeafIndices(tree);
  assignPositions(tree, 0);

  const depth    = maxDepth(tree);
  const svgW     = PAD * 2 + (depth + 1) * DEPTH_W + 100;
  const svgH     = PAD * 2 + Math.max(leafCount, 1) * LEAF_H;

  let edges = "";
  let nodes = "";

  function traverse(node) {
    (node.children ?? []).forEach(child => {
      const mx = (node._x + child._x) / 2;
      edges += `<path d="M${node._x + R},${node._y} C${mx},${node._y} ${mx},${child._y} ${child._x - R},${child._y}"
        fill="none" stroke="#e4e4e7" stroke-width="1.5"/>`;
      traverse(child);
    });

    const st      = getNodeTaskStatus(node, tasks);
    const col     = NODE_COLORS[st];
    const isRoot  = node._x === PAD;
    const nr      = isRoot ? R + 2 : R;
    const fw      = st !== "none" ? "600" : "400";

    // Sensor ring — drawn first so it sits behind the main circle
    const reading   = node.sensor_id ? sensorReadings.get(node.sensor_id) : null;
    const sensorSt  = reading?.status ?? null;
    const ringCfg   = sensorSt ? SENSOR_RING[sensorSt] : null;
    const sensorRing = ringCfg
      ? `<circle cx="${node._x}" cy="${node._y}" r="${nr + 5}"
           fill="none" stroke="${ringCfg.stroke}" stroke-width="${ringCfg.width}"
           class="${ringCfg.cls}" opacity="0.75"/>`
      : "";

    // Sensor value tooltip text (small, below node if alert/warning)
    const sensorLabel = (sensorSt === "alert" || sensorSt === "warning") && reading
      ? `<text x="${node._x}" y="${node._y + nr + 13}"
           text-anchor="middle" font-size="9" fill="${ringCfg.stroke}" font-weight="600">
           ${reading.value} ${reading.unit}
         </text>`
      : "";

    // Task-count badge (top-right corner)
    const taskMatches = tasks.filter(t =>
      (t.component_id && t.component_id === node.id) ||
      t.component_name?.toLowerCase() === node.name?.toLowerCase()
    );
    const badge = taskMatches.length
      ? `<circle cx="${node._x + nr}" cy="${node._y - nr}" r="6" fill="${col.stroke}"/>
         <text x="${node._x + nr}" y="${node._y - nr + 4}" text-anchor="middle"
           font-size="7" fill="white" font-weight="700">${taskMatches.length}</text>`
      : "";

    const sensorTitle = reading
      ? `${node.name} · ${reading.metric}: ${reading.value} ${reading.unit} (${reading.status})`
      : escHtml(node.name);

    nodes += `<g class="maint-svg-node" data-status="${st}" data-sensor="${sensorSt ?? "none"}"
        data-name="${escHtml(node.name)}">
        <title>${sensorTitle}</title>
        ${sensorRing}
        <circle cx="${node._x}" cy="${node._y}" r="${nr}"
          fill="${col.fill}" stroke="${col.stroke}" stroke-width="${st !== "none" ? 2 : 1.5}"/>
        ${badge}
        <text x="${node._x + nr + 6}" y="${node._y + 4}"
          font-size="11" fill="${col.text}" font-weight="${fw}">${escHtml(node.name)}</text>
        ${sensorLabel}
      </g>`;
  }

  traverse(tree);

  return `<svg class="maint-tree-svg" width="${svgW}" height="${svgH}"
    viewBox="0 0 ${svgW} ${svgH}" style="min-height:${svgH}px">
    ${edges}${nodes}
  </svg>`;
}

// ── IoT sensor helpers ─────────────────────────────────────────────────────────

function collectAllSensorIds(docs) {
  const ids = new Set();
  function walk(node) {
    if (node.sensor_id) ids.add(node.sensor_id);
    (node.children ?? []).forEach(walk);
  }
  docs.forEach(d => { if (d.bom) walk(d.bom); });
  return [...ids];
}

// ── Render ─────────────────────────────────────────────────────────────────────

let _docs           = [];
let _year           = new Date().getFullYear();
let _month          = new Date().getMonth(); // 0-indexed
let _sensorReadings = new Map(); // sensor_id → reading object

async function load() {
  try {
    const res = await fetch("/api/maintenance");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    _docs = rows.map(parseMaintDoc);
  } catch (e) {
    document.getElementById("maint-main").innerHTML =
      `<div class="maint-error">Could not load maintenance data: ${escHtml(e.message)}</div>`;
    return;
  }

  // Fetch live sensor readings for every sensor_id found in BOM trees
  const sensorIds = collectAllSensorIds(_docs);
  if (sensorIds.length) {
    try {
      const sRes = await fetch(`/api/iot/sensors?ids=${sensorIds.join(",")}`);
      if (sRes.ok) {
        const readings = await sRes.json();
        _sensorReadings = new Map(readings.map(r => [r.sensor_id, r]));
      }
    } catch (_) {
      // Sensor fetch failure is non-fatal — dashboard still renders without dots
    }
  }

  render();
}

function render() {
  renderNav();
  renderMain();
}

// ── Nav ────────────────────────────────────────────────────────────────────────

function renderNav() {
  const nav = document.getElementById("maint-nav");

  // summary across all docs for selected month + overdue
  const allTasks  = _docs.flatMap(d => d.tasks);
  const monthAll  = allTasks.filter(t => {
    const d = new Date(t.scheduled_date ?? "");
    return d.getFullYear() === _year && d.getMonth() === _month;
  });
  const overdueAll  = allOverdue(allTasks);
  const doneCount   = monthAll.filter(t => t.status === "done").length;
  const upcomingCnt = monthAll.filter(t => taskStatus(t) === "upcoming").length;
  const plannedCnt  = monthAll.filter(t => taskStatus(t) === "planned").length;

  // Sensor stats
  const sensorAlertCnt   = [..._sensorReadings.values()].filter(r => r.status === "alert").length;
  const sensorWarningCnt = [..._sensorReadings.values()].filter(r => r.status === "warning").length;
  const sensorTotal      = _sensorReadings.size;

  nav.innerHTML = `
    <div class="maint-nav-left">
      <a class="maint-back" href="/docs.html">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Docs
      </a>
      <span class="maint-nav-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 4.5v3.8l2.5 1.5" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Maintenance
      </span>
    </div>

    <div class="maint-month-picker">
      <button class="maint-month-btn" id="prevMonth">‹</button>
      <span class="maint-month-label">${MONTH_NAMES[_month]} ${_year}</span>
      <button class="maint-month-btn" id="nextMonth">›</button>
    </div>

    <div class="maint-nav-stats">
      ${overdueAll.length   ? `<span class="maint-stat maint-stat--overdue">${overdueAll.length} overdue</span>`   : ""}
      ${upcomingCnt         ? `<span class="maint-stat maint-stat--upcoming">${upcomingCnt} soon</span>`            : ""}
      ${plannedCnt          ? `<span class="maint-stat maint-stat--planned">${plannedCnt} planned</span>`           : ""}
      ${doneCount           ? `<span class="maint-stat maint-stat--done">${doneCount} done</span>`                  : ""}
      ${sensorAlertCnt      ? `<span class="maint-stat maint-stat--sensor-alert">${sensorAlertCnt} sensor alert${sensorAlertCnt !== 1 ? "s" : ""}</span>` : ""}
      ${!sensorAlertCnt && sensorWarningCnt ? `<span class="maint-stat maint-stat--sensor-warn">${sensorWarningCnt} sensor warn</span>` : ""}
      ${sensorTotal && !sensorAlertCnt && !sensorWarningCnt ? `<span class="maint-stat maint-stat--sensor-ok">${sensorTotal} sensors OK</span>` : ""}
      ${!monthAll.length && !overdueAll.length && !sensorTotal ? `<span class="maint-stat">No tasks</span>` : ""}
    </div>`;

  document.getElementById("prevMonth").addEventListener("click", () => {
    _month--;
    if (_month < 0) { _month = 11; _year--; }
    render();
  });
  document.getElementById("nextMonth").addEventListener("click", () => {
    _month++;
    if (_month > 11) { _month = 0; _year++; }
    render();
  });
}

// ── Main content ───────────────────────────────────────────────────────────────

function renderMain() {
  const main = document.getElementById("maint-main");
  main.innerHTML = "";

  // Global overdue banner
  const allOverdueTasks = _docs.flatMap(d =>
    allOverdue(d.tasks).map(t => ({ ...t, _docTitle: d.title, _docId: d.id }))
  );
  if (allOverdueTasks.length) {
    main.appendChild(buildOverdueBanner(allOverdueTasks));
  }

  // Machine cards — only show docs that have tasks in selected month (or overdue)
  const relevantDocs = _docs.filter(d => {
    const monthTasks   = tasksForMonth(d.tasks, _year, _month);
    const overdueLocal = allOverdue(d.tasks);
    return monthTasks.length > 0 || overdueLocal.length > 0;
  });

  if (!relevantDocs.length) {
    const empty = document.createElement("div");
    empty.className = "maint-empty";
    empty.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="18" stroke="#d1d5db" stroke-width="2"/>
        <path d="M20 12v9l5 3" stroke="#d1d5db" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>No maintenance tasks for <strong>${MONTH_NAMES[_month]} ${_year}</strong></div>
      <div class="maint-empty-sub">Try navigating to a different month, or add tasks in your documents.</div>`;
    main.appendChild(empty);
    return;
  }

  relevantDocs.forEach(doc => main.appendChild(buildMachineCard(doc)));
}

function buildOverdueBanner(tasks) {
  const wrap = document.createElement("div");
  wrap.className = "maint-overdue-banner";
  wrap.innerHTML = `
    <div class="maint-overdue-header">
      <span class="maint-overdue-icon">⚠️</span>
      <strong>${tasks.length} overdue task${tasks.length !== 1 ? "s" : ""}</strong>
      <span class="maint-overdue-sub">Across all machines — action required</span>
    </div>
    <div class="maint-overdue-list">
      ${tasks.map(t => `
        <div class="maint-overdue-row">
          <span class="maint-overdue-machine">${escHtml(t._docTitle)}</span>
          <span class="maint-overdue-comp">${escHtml(t.component_name)}</span>
          <span class="maint-overdue-type">${escHtml(t.task_type)}</span>
          <span class="maint-overdue-date">${formatDate(t.scheduled_date)}</span>
          <a class="maint-overdue-link" href="/?id=${t._docId}">Open doc →</a>
        </div>`).join("")}
    </div>`;
  return wrap;
}

function buildMachineCard(doc) {
  const monthTasks   = tasksForMonth(doc.tasks, _year, _month);
  const overdueLocal = allOverdue(doc.tasks);
  // All tasks relevant to this card (month + overdue, deduplicated)
  const shownTasks = [
    ...overdueLocal,
    ...monthTasks.filter(t => !overdueLocal.find(o => o.id === t.id)),
  ];

  const card = document.createElement("div");
  card.className = "maint-card";

  // ── Card header ────────────────────────────────────────────────────────────
  const hdr = document.createElement("div");
  hdr.className = "maint-card-hdr";
  hdr.innerHTML = `
    <span class="maint-card-title">${escHtml(doc.title)}</span>
    <div class="maint-card-badges">
      ${overdueLocal.length ? `<span class="maint-badge maint-badge--overdue">${overdueLocal.length} overdue</span>` : ""}
      ${monthTasks.length   ? `<span class="maint-badge maint-badge--month">${monthTasks.length} this month</span>`   : ""}
    </div>
    <a class="maint-open-link" href="/?id=${doc.id}">Open document →</a>`;
  card.appendChild(hdr);

  // ── Body: tree + task list ─────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "maint-card-body";

  // Tree visualization
  if (doc.bom) {
    const treeWrap = document.createElement("div");
    treeWrap.className = "maint-tree-wrap";

    const legend = buildLegend();
    treeWrap.appendChild(legend);

    const svgHtml = buildSvg(doc.bom, shownTasks, _sensorReadings);
    treeWrap.innerHTML += svgHtml;
    body.appendChild(treeWrap);
  }

  // Task list
  const taskList = document.createElement("div");
  taskList.className = "maint-task-list";

  if (!shownTasks.length) {
    taskList.innerHTML = `<div class="maint-no-tasks">No tasks for this period</div>`;
  } else {
    shownTasks.forEach(task => {
      const st  = taskStatus(task);
      const row = document.createElement("div");
      row.className = `maint-task-row maint-task-row--${st}`;
      row.innerHTML = `
        <div class="maint-task-main">
          <span class="maint-task-comp">${escHtml(task.component_name || "—")}</span>
          <span class="maint-task-type">${escHtml(task.task_type || "—")}</span>
        </div>
        <div class="maint-task-meta">
          <span class="maint-task-date">${formatDate(task.scheduled_date)}</span>
          <span class="maint-task-pill ${STATUS_CLASS[st]}">${STATUS_LABEL[st]}</span>
        </div>`;
      taskList.appendChild(row);
    });
  }
  body.appendChild(taskList);
  card.appendChild(body);

  return card;
}

function buildLegend() {
  const el = document.createElement("div");
  el.className = "maint-legend";
  el.innerHTML = Object.entries(NODE_COLORS)
    .filter(([k]) => k !== "none")
    .map(([k, c]) => `
      <span class="maint-legend-item">
        <svg width="10" height="10"><circle cx="5" cy="5" r="4"
          fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/></svg>
        ${STATUS_LABEL[k]}
      </span>`).join("") +
    `<span class="maint-legend-item">
      <svg width="10" height="10"><circle cx="5" cy="5" r="4"
        fill="#f4f4f5" stroke="#d1d5db" stroke-width="1.5"/></svg>
      No task
    </span>
    <span class="maint-legend-item" style="margin-left:8px;border-left:1px solid #e4e4e7;padding-left:8px">
      <svg width="14" height="14"><circle cx="7" cy="7" r="3" fill="#fce7f3" stroke="#be185d" stroke-width="1.5"/>
        <circle cx="7" cy="7" r="6" fill="none" stroke="#ef4444" stroke-width="1.5" opacity="0.5"/></svg>
      Sensor alert
    </span>
    <span class="maint-legend-item">
      <svg width="14" height="14"><circle cx="7" cy="7" r="3" fill="#fef3c7" stroke="#f59e0b" stroke-width="1.5"/>
        <circle cx="7" cy="7" r="6" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.5"/></svg>
      Sensor warn
    </span>`;
  return el;
}

// ── Boot ───────────────────────────────────────────────────────────────────────

load();
