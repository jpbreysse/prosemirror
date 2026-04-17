/**
 * AssetGraphNodeView
 *
 * Renders an interactive cooling-water asset graph (ArborSpace CW-101)
 * as an atomic ProseMirror block.  Each instance gets a unique prefix
 * so multiple graphs on the same page never conflict.
 */

import { docStore, randomId } from "../../store/docStore.js";

let _instanceCounter = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Equipment data (mirrors the `D` object in the original HTML)
// ─────────────────────────────────────────────────────────────────────────────
const EQUIPMENT = {
  'CT-101': {
    full: 'Induced Draft Cooling Tower', type: 'Cooling Tower', cat: 'Process',
    sc: '#1D9E75', sl: 'Operational',
    attrs: [['Capacity','5.2 MW'],['Type','Induced draft'],['Fill','PVC crossflow'],['Basin vol.','45 m³']],
    docs: [
      { n:'Operations Manual rev.4',  e:'PDF', d:'2024-03' },
      { n:'ATEX Safety Certificate',  e:'PDF', d:'2023-11' },
      { n:'P&ID Drawing CW-001',      e:'DWG', d:'2022-06' },
    ],
    rels: [
      { d:'→', t:'contains',   p:'B-101'   },
      { d:'→', t:'contains',   p:'P-101A'  },
      { d:'→', t:'contains',   p:'HX-101'  },
      { d:'←', t:'feeds_into', p:'HX-101'  },
    ],
  },
  'B-101': {
    full: 'Cooling Water Collection Basin', type: 'Open Basin', cat: 'Process',
    sc: '#1D9E75', sl: 'Operational',
    attrs: [['Volume','45 m³'],['Material','Concrete lined'],['Level sensor','LT-101'],['Make-up valve','FCV-101']],
    docs: [{ n:'Basin Inspection Report 2024', e:'PDF', d:'2024-09' }],
    rels: [
      { d:'←', t:'contains',   p:'CT-101'  },
      { d:'←', t:'feeds_into', p:'FCV-101' },
      { d:'→', t:'feeds_into', p:'P-101A'  },
      { d:'←', t:'monitors',   p:'LT-101'  },
    ],
  },
  'P-101A': {
    full: 'Cooling Water Circulating Pump A', type: 'Centrifugal Pump', cat: 'Rotating',
    sc: '#1D9E75', sl: 'Running',
    attrs: [['Flow rate','120 m³/h'],['Head','32 m'],['Power','15 kW'],['Impeller','SS316L']],
    docs: [
      { n:'Pump Datasheet — Flowserve MCPF', e:'PDF', d:'2021-04' },
      { n:'Inspection Report Q1-2025',       e:'PDF', d:'2025-01' },
      { n:'P&ID Drawing CW-002',             e:'DWG', d:'2022-06' },
      { n:'Maintenance Procedure MP-044',    e:'PDF', d:'2023-07' },
    ],
    rels: [
      { d:'←', t:'contains',     p:'CT-101'   },
      { d:'←', t:'feeds_into',   p:'B-101'    },
      { d:'→', t:'feeds_into',   p:'HX-101'   },
      { d:'→', t:'component',    p:'M-101A'   },
      { d:'←', t:'controls',     p:'VFD-101A' },
      { d:'→', t:'backed_up_by', p:'P-101B'   },
    ],
  },
  'HX-101': {
    full: 'Cooling Water / Process Heat Exchanger', type: 'Plate Heat Exchanger', cat: 'Process',
    sc: '#D85A30', sl: 'Warning — fouling',
    attrs: [['Duty','4.8 MW'],['Plates','120'],['Fouling factor','0.00024 ↑'],['Last cleaned','2024-02']],
    docs: [
      { n:'Datasheet — Alfa Laval M15', e:'PDF', d:'2021-04' },
      { n:'Fouling Analysis Report',    e:'PDF', d:'2025-02' },
      { n:'Cleaning Procedure CP-031',  e:'PDF', d:'2023-05' },
    ],
    rels: [
      { d:'←', t:'contains',   p:'CT-101'  },
      { d:'←', t:'feeds_into', p:'P-101A'  },
      { d:'→', t:'feeds_into', p:'CT-101'  },
      { d:'←', t:'monitors',   p:'TT-101'  },
    ],
  },
  'M-101A': {
    full: 'P-101A Drive Motor', type: 'Induction Motor', cat: 'Electrical',
    sc: '#1D9E75', sl: 'Running',
    attrs: [['Power','15 kW'],['Voltage','400V 3ph'],['Speed','2950 rpm'],['IE class','IE3']],
    docs: [
      { n:'Motor Specification Sheet',      e:'PDF', d:'2021-04' },
      { n:'Electrical Certificate (ATEX)',  e:'PDF', d:'2021-05' },
    ],
    rels: [{ d:'←', t:'component', p:'P-101A' }],
  },
  'P-101B': {
    full: 'Cooling Water Circulating Pump B — Standby', type: 'Centrifugal Pump', cat: 'Rotating',
    sc: '#BA7517', sl: 'Standby',
    attrs: [['Flow rate','120 m³/h'],['Head','32 m'],['Power','15 kW'],['Start mode','Auto (duty fail)']],
    docs: [{ n:'Pump Datasheet — Flowserve MCPF', e:'PDF', d:'2021-04' }],
    rels: [{ d:'←', t:'backed_up_by', p:'P-101A' }],
  },
  'VFD-101A': {
    full: 'P-101A Variable Frequency Drive', type: 'Variable Frequency Drive', cat: 'Electrical',
    sc: '#1D9E75', sl: 'Running',
    attrs: [['Motor power','15 kW'],['Input','400V 3ph'],['Output freq.','0–50 Hz'],['Protocol','RS-485 Modbus']],
    docs: [
      { n:'VFD Installation Manual — ABB ACS880', e:'PDF', d:'2021-04' },
      { n:'Modbus Register Map v2.1',             e:'PDF', d:'2021-05' },
    ],
    rels: [{ d:'→', t:'controls', p:'P-101A' }],
  },
  'FCV-101': {
    full: 'Make-up Water Control Valve', type: 'Pneumatic Globe Valve', cat: 'Valve',
    sc: '#1D9E75', sl: 'Operational',
    attrs: [['Type','Globe, pneumatic'],['Cv','45'],['Signal','4–20 mA'],['Fail mode','Fail closed']],
    docs: [{ n:'FCV-101 Valve Datasheet', e:'PDF', d:'2021-04' }],
    rels: [{ d:'→', t:'feeds_into', p:'B-101' }],
  },
  'LT-101': {
    full: 'Collection Basin Level Transmitter', type: 'Guided Wave Radar', cat: 'Instrument',
    sc: '#1D9E75', sl: 'Operational',
    attrs: [['Type','Radar, guided wave'],['Range','0–3 m'],['Output','4–20 mA HART'],['Tag','LT-101']],
    docs: [
      { n:'LT-101 Calibration Certificate', e:'PDF', d:'2024-11' },
      { n:'Instrument Data Sheet',           e:'PDF', d:'2021-04' },
    ],
    rels: [{ d:'→', t:'monitors', p:'B-101' }],
  },
  'TT-101': {
    full: 'HX-101 Outlet Temperature Transmitter', type: 'PT100 RTD Transmitter', cat: 'Instrument',
    sc: '#1D9E75', sl: 'Operational',
    attrs: [['Type','PT100 RTD'],['Range','0–120°C'],['Output','4–20 mA HART'],['Location','HX-101 outlet']],
    docs: [{ n:'TT-101 Calibration Certificate', e:'PDF', d:'2025-01' }],
    rels: [{ d:'→', t:'monitors', p:'HX-101' }],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NodeView
// ─────────────────────────────────────────────────────────────────────────────
export class AssetGraphNodeView {
  constructor(node, view, getPos) {
    this.node    = node;
    this.view    = view;
    this.getPos  = getPos;
    this._cur    = null;
    this._uid    = `ag${++_instanceCounter}`;   // unique per instance

    this.dom = document.createElement('div');
    this.dom.className = 'asset-graph-block';
    this._build();
  }

  // ── Build DOM ────────────────────────────────────────────────────────────

  _build() {
    const { title, system } = this.node.attrs;
    const uid = this._uid;

    this.dom.innerHTML = '';

    // ── Header ──────────────────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.className = 'ag-header';
    hdr.innerHTML = `
      <div class="ag-logo">ArborSpace · Asset Management</div>
      <div class="ag-title">${title}</div>
      <div class="ag-sub">10 equipment items · 21 linked documents · 12 relationships · 6 relationship types</div>`;
    this.dom.appendChild(hdr);

    // ── Legend ───────────────────────────────────────────────────────────────
    const legend = document.createElement('div');
    legend.className = 'ag-legend';
    legend.innerHTML = `
      <span class="ag-legend-label">Relationship types:</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#bbb" stroke-width="1.5" stroke-dasharray="4 3"/></svg>contains</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#1D9E75" stroke-width="2"/></svg>feeds into</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#BA7517" stroke-width="1.5" stroke-dasharray="4 3"/></svg>component</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#378ADD" stroke-width="1.5" stroke-dasharray="5 3"/></svg>backed up by</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#3730A3" stroke-width="2"/></svg>controls</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#CB6A11" stroke-width="1.5" stroke-dasharray="3 2"/></svg>monitors</span>
      <span class="ag-li ag-legend-note">Badge = doc count · Dashed border = standby</span>`;
    this.dom.appendChild(legend);

    // ── SVG graph ────────────────────────────────────────────────────────────
    const graphWrap = document.createElement('div');
    graphWrap.className = 'ag-graph-wrap';
    // Unique marker IDs per instance to avoid cross-instance conflicts
    graphWrap.innerHTML = `
<svg width="100%" viewBox="0 0 1080 490" style="display:block;min-width:820px">
  <defs>
    <marker id="${uid}-ag"  viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#bbb"     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <marker id="${uid}-agr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#1D9E75" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <marker id="${uid}-aa"  viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#BA7517" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <marker id="${uid}-ab"  viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#378ADD" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <marker id="${uid}-ai"  viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#3730A3" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
    <marker id="${uid}-ao"  viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#CB6A11" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>
  </defs>

  <!-- CONTAINS: CT-101 → B-101, P-101A, HX-101 -->
  <path d="M540,94 L540,148 L155,148 L155,205" fill="none" stroke="#bbb" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#${uid}-ag)"/>
  <path d="M540,94 L540,205"                   fill="none" stroke="#bbb" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#${uid}-ag)"/>
  <path d="M540,94 L540,148 L875,148 L875,205" fill="none" stroke="#bbb" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#${uid}-ag)"/>

  <!-- FEEDS_INTO -->
  <line x1="225" y1="228" x2="465" y2="228"   stroke="#1D9E75" stroke-width="1.5" marker-end="url(#${uid}-agr)"/>
  <line x1="615" y1="228" x2="800" y2="228"   stroke="#1D9E75" stroke-width="1.5" marker-end="url(#${uid}-agr)"/>
  <path d="M875,205 C875,18 540,18 540,48"    fill="none" stroke="#1D9E75" stroke-width="1.5" marker-end="url(#${uid}-agr)"/>
  <path d="M90,375 L90,310 L85,310 L85,228"   fill="none" stroke="#1D9E75" stroke-width="1" marker-end="url(#${uid}-agr)"/>

  <!-- COMPONENT: P-101A → M-101A -->
  <path d="M505,251 L505,312 L385,312 L385,375" fill="none" stroke="#BA7517" stroke-width="1" stroke-dasharray="4 3" marker-end="url(#${uid}-aa)"/>

  <!-- BACKED_UP_BY: P-101A → P-101B -->
  <path d="M575,251 L575,312 L685,312 L685,375" fill="none" stroke="#378ADD" stroke-width="1" stroke-dasharray="6 3" marker-end="url(#${uid}-ab)"/>

  <!-- CONTROLS: VFD-101A → P-101A -->
  <path d="M535,375 L535,323 L560,323 L560,251" fill="none" stroke="#3730A3" stroke-width="1.5" marker-end="url(#${uid}-ai)"/>

  <!-- MONITORS -->
  <path d="M235,375 L235,323 L155,323 L155,251" fill="none" stroke="#CB6A11" stroke-width="1" stroke-dasharray="3 2" marker-end="url(#${uid}-ao)"/>
  <path d="M845,375 L845,323 L875,323 L875,251" fill="none" stroke="#CB6A11" stroke-width="1" stroke-dasharray="3 2" marker-end="url(#${uid}-ao)"/>

  <!-- edge labels -->
  <text x="445" y="306" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#BA7517">component</text>
  <text x="630" y="306" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#378ADD">standby</text>
  <text x="548" y="350" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#3730A3">controls</text>

  <!-- ROW 1 — CT-101 -->
  <g class="ag-eq" data-id="CT-101">
    <rect class="ag-bg" x="465" y="48" width="150" height="46" rx="9" fill="#dff5ec" stroke="#0d6b52" stroke-width="1"/>
    <text x="540" y="68"  text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#074f3d">CT-101</text>
    <text x="540" y="83"  text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#0d6b52">Cooling Tower</text>
    <rect x="595" y="50" width="18" height="14" rx="3" fill="white" stroke="#0d6b52" stroke-width="0.5"/>
    <text x="604" y="57" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#074f3d">3</text>
  </g>

  <!-- ROW 2 — B-101, P-101A, HX-101 -->
  <g class="ag-eq" data-id="B-101">
    <rect class="ag-bg" x="85" y="205" width="140" height="46" rx="9" fill="#e3edf9" stroke="#1558a0" stroke-width="1"/>
    <text x="155" y="225" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#0c4179">B-101</text>
    <text x="155" y="240" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#1558a0">Collection Basin</text>
    <rect x="205" y="207" width="18" height="14" rx="3" fill="white" stroke="#1558a0" stroke-width="0.5"/>
    <text x="214" y="214" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#0c4179">1</text>
  </g>

  <g class="ag-eq" data-id="P-101A">
    <rect class="ag-bg" x="465" y="205" width="150" height="46" rx="9" fill="#eceafe" stroke="#4f45b5" stroke-width="1"/>
    <text x="540" y="225" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#3a3187">P-101A</text>
    <text x="540" y="240" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#4f45b5">Circulating Pump</text>
    <rect x="595" y="207" width="18" height="14" rx="3" fill="white" stroke="#4f45b5" stroke-width="0.5"/>
    <text x="604" y="214" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#3a3187">4</text>
  </g>

  <g class="ag-eq" data-id="HX-101">
    <rect class="ag-bg" x="800" y="205" width="150" height="46" rx="9" fill="#f9e9e5" stroke="#923719" stroke-width="1"/>
    <text x="875" y="225" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#6a2811">HX-101</text>
    <text x="875" y="240" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#923719">Heat Exchanger</text>
    <rect x="930" y="207" width="18" height="14" rx="3" fill="white" stroke="#923719" stroke-width="0.5"/>
    <text x="939" y="214" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#6a2811">3</text>
  </g>

  <!-- ROW 3 — instruments & components -->
  <g class="ag-eq" data-id="FCV-101">
    <rect class="ag-bg" x="25" y="375" width="130" height="46" rx="9" fill="#e5f0e9" stroke="#1f6640" stroke-width="1"/>
    <text x="90" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#155230">FCV-101</text>
    <text x="90" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#1f6640">Make-up Valve</text>
    <rect x="135" y="377" width="18" height="14" rx="3" fill="white" stroke="#1f6640" stroke-width="0.5"/>
    <text x="144" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#155230">1</text>
  </g>

  <g class="ag-eq" data-id="LT-101">
    <rect class="ag-bg" x="170" y="375" width="130" height="46" rx="9" fill="#fdf2d8" stroke="#946b0c" stroke-width="1"/>
    <text x="235" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#6e5009">LT-101</text>
    <text x="235" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#946b0c">Level Transmitter</text>
    <rect x="280" y="377" width="18" height="14" rx="3" fill="white" stroke="#946b0c" stroke-width="0.5"/>
    <text x="289" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#6e5009">2</text>
  </g>

  <g class="ag-eq" data-id="M-101A">
    <rect class="ag-bg" x="315" y="375" width="140" height="46" rx="9" fill="#faecd6" stroke="#7e4b09" stroke-width="1"/>
    <text x="385" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#5c3505">M-101A</text>
    <text x="385" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#7e4b09">Drive Motor</text>
    <rect x="435" y="377" width="18" height="14" rx="3" fill="white" stroke="#7e4b09" stroke-width="0.5"/>
    <text x="444" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#5c3505">2</text>
  </g>

  <g class="ag-eq" data-id="VFD-101A">
    <rect class="ag-bg" x="465" y="375" width="140" height="46" rx="9" fill="#eae8fc" stroke="#3730a3" stroke-width="1"/>
    <text x="535" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#2c2680">VFD-101A</text>
    <text x="535" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#3730a3">Variable Freq. Drive</text>
    <rect x="585" y="377" width="18" height="14" rx="3" fill="white" stroke="#3730a3" stroke-width="0.5"/>
    <text x="594" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#2c2680">2</text>
  </g>

  <g class="ag-eq ag-standby" data-id="P-101B">
    <rect class="ag-bg" x="615" y="375" width="140" height="46" rx="9" fill="#eceafe" stroke="#4f45b5" stroke-width="1" stroke-dasharray="5 2"/>
    <text x="685" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#3a3187">P-101B</text>
    <text x="685" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#4f45b5">Standby Pump</text>
    <rect x="735" y="377" width="18" height="14" rx="3" fill="white" stroke="#4f45b5" stroke-width="0.5"/>
    <text x="744" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#3a3187">1</text>
  </g>

  <g class="ag-eq" data-id="TT-101">
    <rect class="ag-bg" x="770" y="375" width="130" height="46" rx="9" fill="#fdf2d8" stroke="#946b0c" stroke-width="1"/>
    <text x="835" y="395" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#6e5009">TT-101</text>
    <text x="835" y="410" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" fill="#946b0c">Temp. Transmitter</text>
    <rect x="880" y="377" width="18" height="14" rx="3" fill="white" stroke="#946b0c" stroke-width="0.5"/>
    <text x="889" y="384" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#6e5009">1</text>
  </g>
</svg>`;
    this.dom.appendChild(graphWrap);

    // Wire up click handlers (no global functions — scoped to this instance)
    graphWrap.querySelectorAll('.ag-eq').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => this._sel(el.dataset.id));
    });

    // ── Detail panel ─────────────────────────────────────────────────────────
    this._det = document.createElement('div');
    this._det.className = 'ag-detail';
    this._det.innerHTML = '<div class="ag-hint">↑ Click any equipment node to explore linked documents, technical attributes, and relationships</div>';
    this.dom.appendChild(this._det);

    // Re-apply selection if one was active before a re-render
    if (this._cur) this._highlightNode(this._cur);
  }

  // ── Selection ────────────────────────────────────────────────────────────

  _sel(id) {
    if (this._cur) this._highlightNode(this._cur, false);
    this._cur = id;
    this._highlightNode(id, true);
    this._renderDetail(id);
  }

  _highlightNode(id, on = true) {
    const el = this.dom.querySelector(`.ag-eq[data-id="${id}"]`);
    if (!el) return;
    el.classList.toggle('ag-sel', on);
    const bg = el.querySelector('.ag-bg');
    if (bg) {
      bg.style.filter      = on ? 'drop-shadow(0 0 6px rgba(0,0,0,.22))' : '';
      bg.style.strokeWidth = on ? '2.5' : '';
    }
  }

  // ── Detail panel renderer ────────────────────────────────────────────────

  _renderDetail(id) {
    const d = EQUIPMENT[id];
    if (!d) return;

    const attrs = d.attrs.map(([k, v]) => `
      <div class="ag-attr">
        <div class="ag-al">${k}</div>
        <div class="ag-av">${v}</div>
      </div>`).join('');

    const docs = d.docs.map(x => {
      const isDWG = x.e === 'DWG';
      const bg = isDWG ? '#FAEEDA' : '#E6F1FB';
      const fc = isDWG ? '#633806' : '#0C447C';
      return `<div class="ag-doc">
        <span class="ag-ext" style="background:${bg};color:${fc}">${x.e}</span>
        <span class="ag-dn">${x.n}</span>
        <span class="ag-dd">${x.d}</span>
      </div>`;
    }).join('');

    const rels = d.rels.map(r =>
      `<span class="ag-rel">${r.d} <strong>${r.t}</strong> ${r.p}</span>`
    ).join('');

    // Does this node already have a linked doc?
    const existingDocId = (this.node.attrs.equipmentDocs || {})[id];
    const openLabel = existingDocId ? 'Open document →' : 'Create document →';

    this._det.innerHTML = `
      <div class="ag-det-header">
        <div>
          <div><span class="ag-did">${id}</span><span class="ag-cat">${d.cat}</span></div>
          <div class="ag-dfull">${d.full} · <em>${d.type}</em></div>
        </div>
        <div class="ag-det-actions">
          <div class="ag-sta">
            <span class="ag-dot" style="background:${d.sc}"></span>${d.sl}
          </div>
          <button class="ag-open-btn" data-eq="${id}">${openLabel}</button>
        </div>
      </div>
      <div class="ag-sec">Technical attributes</div>
      <div class="ag-attrs">${attrs}</div>
      <div class="ag-sec">Linked documents (${d.docs.length})</div>
      <div class="ag-docs">${docs}</div>
      <div class="ag-sec">Relationships (${d.rels.length})</div>
      <div class="ag-rels">${rels}</div>`;

    // Wire up the open button
    this._det.querySelector('.ag-open-btn').addEventListener('click', () => {
      this._openEquipmentDoc(id);
    });
  }

  // ── Create / open the linked ProseMirror document ────────────────────────

  async _openEquipmentDoc(id) {
    const d = EQUIPMENT[id];
    if (!d) return;

    const btn = this._det.querySelector('.ag-open-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }

    // Reuse existing docId or create a fresh one
    const equipmentDocs = { ...(this.node.attrs.equipmentDocs || {}) };
    let docId = equipmentDocs[id];

    if (!docId) {
      docId = randomId();

      // Build a pre-filled ProseMirror document from the equipment data
      const initialJSON = this._buildEquipmentDoc(id, d);
      await docStore.create(docId, `${id} — ${d.full}`, initialJSON);

      // Persist the docId back into the node attrs
      equipmentDocs[id] = docId;
      const tr = this.view.state.tr.setNodeMarkup(
        this.getPos(),
        null,
        { ...this.node.attrs, equipmentDocs },
      );
      this.view.dispatch(tr);
    }

    // Navigate to the editor with this document
    window.location.href = `/?id=${docId}`;
  }

  // ── Build pre-filled doc JSON from equipment data ────────────────────────

  _buildEquipmentDoc(id, d) {
    // Only add marks when non-empty — ProseMirror forbids empty text nodes
    // and ignores marks keys that are absent.
    const txt = (text, marks) => {
      const node = { type: 'text', text };
      if (marks?.length) node.marks = marks;
      return node;
    };
    const para    = (...content) => ({ type: 'paragraph', content });
    const emptyP  = ()           => ({ type: 'paragraph', content: [] });
    const heading = (level, text) => ({
      type: 'heading', attrs: { level },
      content: [{ type: 'text', text }],
    });
    const bullet  = items => ({
      type: 'bullet_list',
      content: items.map(text => ({
        type: 'list_item',
        content: [para(txt(text))],
      })),
    });
    const hr = () => ({ type: 'horizontal_rule' });

    const attrItems = d.attrs.map(([k, v]) => `${k}: ${v}`);
    const docItems  = d.docs.map(x => `[${x.e}] ${x.n} — ${x.d}`);
    const relItems  = d.rels.map(r => `${r.d} ${r.t} → ${r.p}`);

    return {
      type: 'doc',
      content: [
        heading(1, `${id} — ${d.full}`),
        para(
          txt(`${d.type}  ·  ${d.cat}  ·  `),
          txt(d.sl, [{ type: 'strong' }]),
        ),
        hr(),

        heading(2, 'Technical Attributes'),
        bullet(attrItems),

        heading(2, `Linked Documents (${d.docs.length})`),
        bullet(docItems),

        heading(2, `Relationships (${d.rels.length})`),
        bullet(relItems),

        hr(),
        heading(2, 'Notes'),
        emptyP(),
      ],
    };
  }

  // ── ProseMirror NodeView interface ───────────────────────────────────────

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Re-render header if title changed
    const hdr = this.dom.querySelector('.ag-title');
    if (hdr) hdr.textContent = node.attrs.title;
    return true;
  }

  stopEvent()      { return true;  }
  ignoreMutation() { return true;  }
  destroy()        { /* nothing to tear down */ }
}
