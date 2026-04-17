/**
 * CarGraphNodeView
 *
 * Interactive PHEV drivetrain architecture graph.
 * Layout:
 *   Row 0 — VCU (Vehicle Control Unit)
 *   Row 1 — ICE · Gearbox · Power Control Unit · HV Battery
 *   Row 2 — Front Electric Motor · Front Diff · Rear Diff · Rear Electric Motor
 *   Row 3 — Motor Cooling Loop · Battery Cooling Loop
 *
 * Relationship types:
 *   drives    — mechanical power flow (green solid)
 *   powers    — electrical power flow (indigo solid)
 *   controls  — electronic signals  (purple solid)
 *   cools     — thermal management  (cyan dashed)
 */

import { docStore, randomId } from "../../store/docStore.js";

let _instanceCounter = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Equipment catalogue
// ─────────────────────────────────────────────────────────────────────────────
const EQUIPMENT = {
  'VCU-001': {
    full: 'Vehicle Control Unit', type: 'Central ECU', cat: 'Control',
    sc: '#3730a3', sl: 'Active',
    attrs: [['Processor','ARM Cortex-A72 × 4'],['RTOS','AUTOSAR CP'],['CAN buses','6 × 500 kbps'],['Refresh','10 ms']],
    docs: [
      { n:'VCU Software Architecture v3.2', e:'PDF', d:'2024-06' },
      { n:'CAN Network Wiring Diagram',     e:'DWG', d:'2023-09' },
      { n:'Functional Safety Assessment',   e:'PDF', d:'2023-11' },
    ],
    rels: [
      { d:'→', t:'controls', p:'ICE-001' },
      { d:'→', t:'controls', p:'PCU-001' },
      { d:'→', t:'controls', p:'COOL-M'  },
      { d:'→', t:'controls', p:'COOL-B'  },
    ],
  },
  'ICE-001': {
    full: '2.0L Turbocharged Petrol Engine', type: 'Internal Combustion Engine', cat: 'Powertrain',
    sc: '#d97706', sl: 'Ready',
    attrs: [['Displacement','2 000 cm³'],['Max power','150 kW @ 5 500 rpm'],['Max torque','320 Nm @ 2 000 rpm'],['Emission','Euro 6d'],['Cylinders','4 inline']],
    docs: [
      { n:'Engine Workshop Manual rev.7', e:'PDF', d:'2023-01' },
      { n:'Engine Assembly Drawing',      e:'DWG', d:'2022-11' },
      { n:'Emissions Certificate Euro 6d', e:'PDF', d:'2022-09' },
    ],
    rels: [
      { d:'←', t:'controls', p:'VCU-001' },
      { d:'→', t:'drives',   p:'GB-001'  },
    ],
  },
  'GB-001': {
    full: '8-Speed Dual-Clutch Transmission', type: 'DCT Gearbox', cat: 'Powertrain',
    sc: '#059669', sl: 'Ready',
    attrs: [['Ratios','8 forward + R'],['Max torque','520 Nm input'],['Clutch type','Dual wet clutch'],['Oil type','DCT fluid'],['Mass','82 kg']],
    docs: [
      { n:'DCT Service Manual', e:'PDF', d:'2023-03' },
      { n:'Gearbox Assembly Drawing', e:'DWG', d:'2022-11' },
    ],
    rels: [
      { d:'←', t:'drives', p:'ICE-001' },
      { d:'→', t:'drives', p:'DIFF-F'  },
    ],
  },
  'PCU-001': {
    full: 'Power Control Unit — Inverter & DC/DC', type: 'Power Electronics', cat: 'Electric Drive',
    sc: '#4f46e5', sl: 'Active',
    attrs: [['Peak power','220 kW combined'],['Input','360–420V DC'],['Output','3-phase AC 0–16 000 rpm'],['Efficiency','97.4%'],['Cooling','Liquid plate']],
    docs: [
      { n:'PCU Installation Manual', e:'PDF', d:'2023-07' },
      { n:'Thermal Derating Curve',  e:'PDF', d:'2023-05' },
    ],
    rels: [
      { d:'←', t:'powered by', p:'BAT-001' },
      { d:'←', t:'controls',   p:'VCU-001' },
      { d:'→', t:'powers',     p:'EM-001'  },
      { d:'→', t:'powers',     p:'EM-002'  },
    ],
  },
  'BAT-001': {
    full: 'High-Voltage Lithium-Ion Battery Pack', type: 'Traction Battery', cat: 'Energy',
    sc: '#b45309', sl: 'Charging — 78%',
    attrs: [['Net capacity','18.4 kWh'],['Voltage','400V nominal'],['Chemistry','NMC 811'],['Cells','5 184'],['Mass','215 kg'],['BMS','Integrated']],
    docs: [
      { n:'Battery Safety & Handling Manual', e:'PDF', d:'2023-08' },
      { n:'Battery Module Assembly Drawing',  e:'DWG', d:'2022-10' },
      { n:'UN38.3 Transport Certificate',     e:'PDF', d:'2022-12' },
    ],
    rels: [
      { d:'→', t:'powers', p:'PCU-001' },
      { d:'←', t:'cools',  p:'COOL-B'  },
    ],
  },
  'EM-001': {
    full: 'Front Axle Permanent Magnet Synchronous Motor', type: 'PMSM', cat: 'Electric Drive',
    sc: '#7c3aed', sl: 'Ready',
    attrs: [['Peak power','120 kW'],['Continuous','60 kW'],['Peak torque','250 Nm'],['Max speed','16 000 rpm'],['Cooling','Liquid jacket']],
    docs: [
      { n:'Front Motor Datasheet — Hitachi', e:'PDF', d:'2023-06' },
      { n:'Motor Assembly Drawing',          e:'DWG', d:'2022-12' },
    ],
    rels: [
      { d:'←', t:'powers', p:'PCU-001' },
      { d:'→', t:'drives', p:'DIFF-F'  },
      { d:'←', t:'cools',  p:'COOL-M'  },
    ],
  },
  'EM-002': {
    full: 'Rear Axle Permanent Magnet Synchronous Motor', type: 'PMSM', cat: 'Electric Drive',
    sc: '#7c3aed', sl: 'Ready',
    attrs: [['Peak power','100 kW'],['Continuous','50 kW'],['Peak torque','220 Nm'],['Max speed','16 000 rpm'],['Cooling','Liquid jacket']],
    docs: [
      { n:'Rear Motor Datasheet — Hitachi', e:'PDF', d:'2023-06' },
    ],
    rels: [
      { d:'←', t:'powers', p:'PCU-001' },
      { d:'→', t:'drives', p:'DIFF-R'  },
      { d:'←', t:'cools',  p:'COOL-M'  },
    ],
  },
  'DIFF-F': {
    full: 'Front Axle Open Differential', type: 'Open Differential', cat: 'Drivetrain',
    sc: '#0f766e', sl: 'Ready',
    attrs: [['Type','Open bevel gear'],['Final ratio','3.73 : 1'],['Max torque in','900 Nm'],['Mass','18 kg']],
    docs: [{ n:'Front Axle Assembly Manual', e:'PDF', d:'2022-11' }],
    rels: [
      { d:'←', t:'drives', p:'GB-001'  },
      { d:'←', t:'drives', p:'EM-001'  },
    ],
  },
  'DIFF-R': {
    full: 'Rear Axle Electronic Limited-Slip Differential', type: 'eLSD', cat: 'Drivetrain',
    sc: '#0f766e', sl: 'Ready',
    attrs: [['Type','Electronic LSD'],['Final ratio','3.15 : 1'],['Lock range','0–100%'],['Actuator','Electro-hydraulic'],['Max torque in','600 Nm']],
    docs: [
      { n:'Rear Axle Assembly Manual', e:'PDF', d:'2022-11' },
      { n:'eLSD Calibration Guide',    e:'PDF', d:'2023-04' },
    ],
    rels: [
      { d:'←', t:'drives',   p:'EM-002'  },
      { d:'←', t:'controls', p:'VCU-001' },
    ],
  },
  'COOL-M': {
    full: 'Motor & Power Electronics Cooling Loop', type: 'Liquid Cooling Circuit', cat: 'Thermal',
    sc: '#0284c7', sl: 'Active',
    attrs: [['Coolant','50 % glycol–water'],['Flow rate','12 L/min'],['Pump','Electric 0.4 kW'],['Thermostat','82°C opening'],['Radiator','Dual-pass aluminium']],
    docs: [{ n:'Motor Thermal System Manual', e:'PDF', d:'2023-06' }],
    rels: [
      { d:'←', t:'controls', p:'VCU-001' },
      { d:'→', t:'cools',    p:'EM-001'  },
      { d:'→', t:'cools',    p:'EM-002'  },
      { d:'→', t:'cools',    p:'PCU-001' },
    ],
  },
  'COOL-B': {
    full: 'Battery Thermal Management System', type: 'Refrigerant Chiller Loop', cat: 'Thermal',
    sc: '#0284c7', sl: 'Active',
    attrs: [['Refrigerant','R1234yf'],['Chiller','3.5 kW'],['Heater','PTC 4 kW'],['Cell target','25°C ± 3°C'],['Flow','8 L/min']],
    docs: [{ n:'Battery TMS Manual', e:'PDF', d:'2023-08' }],
    rels: [
      { d:'←', t:'controls', p:'VCU-001' },
      { d:'→', t:'cools',    p:'BAT-001' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Subgraph definitions — internal architecture for key components
// ─────────────────────────────────────────────────────────────────────────────
const SUBGRAPHS = {
  'ICE-001': {
    title: 'ICE-001 — 2.0L Turbocharged Engine · Internal Architecture',
    nodes: [
      { id: 'TURBO',  label: 'TURBO',    sublabel: 'Turbocharger',         color: '#fef3c7', border: '#d97706' },
      { id: 'INJ',    label: 'INJ',      sublabel: 'Fuel Injectors',       color: '#fef9c3', border: '#ca8a04' },
      { id: 'CAM-I',  label: 'CAM-I',   sublabel: 'Intake Camshaft',      color: '#d1fae5', border: '#059669' },
      { id: 'CAM-E',  label: 'CAM-E',   sublabel: 'Exhaust Camshaft',     color: '#d1fae5', border: '#059669' },
      { id: 'PIST',   label: 'PIST 1–4', sublabel: '4 × Pistons',         color: '#fef3c7', border: '#d97706' },
      { id: 'CRANK',  label: 'CRANK',    sublabel: 'Crankshaft',           color: '#fef3c7', border: '#b45309' },
      { id: 'OIL-P',  label: 'OIL-P',  sublabel: 'Oil Pump',              color: '#e0e7ff', border: '#6366f1' },
      { id: 'COOL-P', label: 'COOL-P',  sublabel: 'Coolant Pump',         color: '#dbeafe', border: '#3b82f6' },
    ],
    edges: [
      { source: 'TURBO',  target: 'PIST',  type: 'boosts',   label: 'boosts'           },
      { source: 'INJ',    target: 'PIST',  type: 'injects',  label: 'injects fuel'     },
      { source: 'CAM-I',  target: 'PIST',  type: 'controls', label: 'controls intake'  },
      { source: 'CAM-E',  target: 'PIST',  type: 'controls', label: 'controls exhaust' },
      { source: 'PIST',   target: 'CRANK', type: 'drives',   label: 'drives'           },
      { source: 'OIL-P',  target: 'CRANK', type: 'lubricates', label: 'lubricates'     },
      { source: 'COOL-P', target: 'PIST',  type: 'cools',    label: 'cools'            },
    ],
  },
  'EM-001': {
    title: 'EM-001 — Front PMSM · Internal Architecture',
    nodes: [
      { id: 'COOL-J', label: 'COOL-J',  sublabel: 'Liquid Cooling Jacket',    color: '#dbeafe', border: '#3b82f6' },
      { id: 'STATOR', label: 'STATOR',  sublabel: 'Stator Windings (3-ph)',   color: '#ede9fe', border: '#7c3aed' },
      { id: 'ROTOR',  label: 'ROTOR',   sublabel: 'Permanent Magnet Rotor',   color: '#ede9fe', border: '#7c3aed' },
      { id: 'RESV',   label: 'RESV',    sublabel: 'Resolver (position)',       color: '#fef9c3', border: '#ca8a04' },
      { id: 'SHAFT',  label: 'SHAFT',   sublabel: 'Output Shaft',             color: '#f3f4f6', border: '#6b7280' },
      { id: 'BRG-F',  label: 'BRG-F',  sublabel: 'Front Bearing',            color: '#f3f4f6', border: '#6b7280' },
      { id: 'BRG-R',  label: 'BRG-R',  sublabel: 'Rear Bearing',             color: '#f3f4f6', border: '#6b7280' },
    ],
    edges: [
      { source: 'COOL-J', target: 'STATOR', type: 'cools',    label: 'cools'    },
      { source: 'STATOR', target: 'ROTOR',  type: 'EM force', label: 'EM force' },
      { source: 'RESV',   target: 'ROTOR',  type: 'monitors', label: 'monitors' },
      { source: 'ROTOR',  target: 'SHAFT',  type: 'drives',   label: 'drives'   },
      { source: 'BRG-F',  target: 'SHAFT',  type: 'supports', label: 'supports' },
      { source: 'BRG-R',  target: 'SHAFT',  type: 'supports', label: 'supports' },
    ],
  },
  'EM-002': {
    title: 'EM-002 — Rear PMSM · Internal Architecture',
    nodes: [
      { id: 'COOL-J', label: 'COOL-J',  sublabel: 'Liquid Cooling Jacket',    color: '#dbeafe', border: '#3b82f6' },
      { id: 'STATOR', label: 'STATOR',  sublabel: 'Stator Windings (3-ph)',   color: '#ede9fe', border: '#7c3aed' },
      { id: 'ROTOR',  label: 'ROTOR',   sublabel: 'Permanent Magnet Rotor',   color: '#ede9fe', border: '#7c3aed' },
      { id: 'RESV',   label: 'RESV',    sublabel: 'Resolver (position)',       color: '#fef9c3', border: '#ca8a04' },
      { id: 'SHAFT',  label: 'SHAFT',   sublabel: 'Output Shaft',             color: '#f3f4f6', border: '#6b7280' },
      { id: 'BRG-F',  label: 'BRG-F',  sublabel: 'Front Bearing',            color: '#f3f4f6', border: '#6b7280' },
      { id: 'BRG-R',  label: 'BRG-R',  sublabel: 'Rear Bearing',             color: '#f3f4f6', border: '#6b7280' },
    ],
    edges: [
      { source: 'COOL-J', target: 'STATOR', type: 'cools',    label: 'cools'    },
      { source: 'STATOR', target: 'ROTOR',  type: 'EM force', label: 'EM force' },
      { source: 'RESV',   target: 'ROTOR',  type: 'monitors', label: 'monitors' },
      { source: 'ROTOR',  target: 'SHAFT',  type: 'drives',   label: 'drives'   },
      { source: 'BRG-F',  target: 'SHAFT',  type: 'supports', label: 'supports' },
      { source: 'BRG-R',  target: 'SHAFT',  type: 'supports', label: 'supports' },
    ],
  },
  'BAT-001': {
    title: 'BAT-001 — HV Battery Pack · Internal Architecture',
    nodes: [
      { id: 'BMS',  label: 'BMS',   sublabel: 'Battery Management System',  color: '#e0e7ff', border: '#4f46e5' },
      { id: 'CHRG', label: 'CHRG',  sublabel: 'Charge Port (AC + DC)',       color: '#d1fae5', border: '#059669' },
      { id: 'HEAT', label: 'PTC',   sublabel: 'PTC Heater (4 kW)',           color: '#fee2e2', border: '#dc2626' },
      { id: 'CHIL', label: 'CHIL',  sublabel: 'Chiller Plate (3.5 kW)',      color: '#dbeafe', border: '#3b82f6' },
      { id: 'CELL', label: 'CELLS', sublabel: '5 184 × NMC-811 Cells',       color: '#fef9c3', border: '#ca8a04' },
      { id: 'JBOX', label: 'J-BOX', sublabel: 'Junction Box',                color: '#f3f4f6', border: '#6b7280' },
      { id: 'CONT', label: 'CONT',  sublabel: 'Main Contactors (+/−)',       color: '#f3f4f6', border: '#6b7280' },
      { id: 'PRE',  label: 'PRE',   sublabel: 'Pre-charge Relay',            color: '#f3f4f6', border: '#6b7280' },
    ],
    edges: [
      { source: 'BMS',  target: 'CELL', type: 'monitors', label: 'monitors'   },
      { source: 'BMS',  target: 'CONT', type: 'controls', label: 'controls'   },
      { source: 'BMS',  target: 'PRE',  type: 'controls', label: 'controls'   },
      { source: 'CHRG', target: 'CELL', type: 'charges',  label: 'charges'    },
      { source: 'HEAT', target: 'CELL', type: 'heats',    label: 'heats'      },
      { source: 'CHIL', target: 'CELL', type: 'cools',    label: 'cools'      },
      { source: 'CELL', target: 'JBOX', type: 'powers',   label: 'powers'     },
      { source: 'JBOX', target: 'CONT', type: 'feeds',    label: 'feeds HV'   },
    ],
  },
  'PCU-001': {
    title: 'PCU-001 — Power Control Unit · Internal Architecture',
    nodes: [
      { id: 'CAP',   label: 'CAP',   sublabel: 'DC-link Capacitor',      color: '#fef9c3', border: '#ca8a04' },
      { id: 'DCDC',  label: 'DC/DC', sublabel: '12V DC/DC Converter',    color: '#d1fae5', border: '#059669' },
      { id: 'GATE',  label: 'GATE',  sublabel: 'Gate Driver PCB',        color: '#ede9fe', border: '#7c3aed' },
      { id: 'INV-F', label: 'INV-F', sublabel: 'Front Inverter (3-ph)',  color: '#e0e7ff', border: '#4f46e5' },
      { id: 'INV-R', label: 'INV-R', sublabel: 'Rear Inverter (3-ph)',   color: '#e0e7ff', border: '#4f46e5' },
      { id: 'TMCU',  label: 'TMCU',  sublabel: 'Thermal Interface Plate',color: '#dbeafe', border: '#3b82f6' },
    ],
    edges: [
      { source: 'CAP',  target: 'INV-F', type: 'buffers', label: 'DC buffer'  },
      { source: 'CAP',  target: 'INV-R', type: 'buffers', label: 'DC buffer'  },
      { source: 'DCDC', target: 'GATE',  type: 'powers',  label: '12V supply' },
      { source: 'GATE', target: 'INV-F', type: 'drives',  label: 'gate drive' },
      { source: 'GATE', target: 'INV-R', type: 'drives',  label: 'gate drive' },
      { source: 'TMCU', target: 'INV-F', type: 'cools',   label: 'cools'      },
      { source: 'TMCU', target: 'INV-R', type: 'cools',   label: 'cools'      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NodeView
// ─────────────────────────────────────────────────────────────────────────────
export class CarGraphNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;
    this._cur   = null;
    this._uid   = `cg${++_instanceCounter}`;

    this.dom = document.createElement('div');
    this.dom.className = 'asset-graph-block';
    this._build();
  }

  _build() {
    const uid = this._uid;
    this.dom.innerHTML = '';

    // ── Header ────────────────────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.className = 'ag-header';
    hdr.innerHTML = `
      <div class="ag-logo">ArborSpace · Vehicle Engineering</div>
      <div class="ag-title">${this.node.attrs.title}</div>
      <div class="ag-sub">11 components · PHEV architecture · 4 subsystem groups · 4 relationship types</div>`;
    this.dom.appendChild(hdr);

    // ── Legend ────────────────────────────────────────────────────────────────
    const legend = document.createElement('div');
    legend.className = 'ag-legend';
    legend.innerHTML = `
      <span class="ag-legend-label">Relationship types:</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#059669" stroke-width="2"/></svg>drives</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#4f46e5" stroke-width="2"/></svg>powers</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#7c3aed" stroke-width="2"/></svg>controls</span>
      <span class="ag-li"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4 3"/></svg>cools</span>
      <span class="ag-legend-note">Badge = doc count · Click node to explore</span>`;
    this.dom.appendChild(legend);

    // ── SVG ───────────────────────────────────────────────────────────────────
    const graphWrap = document.createElement('div');
    graphWrap.className = 'ag-graph-wrap';
    graphWrap.innerHTML = `
<svg width="100%" viewBox="0 0 1080 490" style="display:block;min-width:860px">
  <defs>
    <!-- drives: green -->
    <marker id="${uid}-dr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
    <!-- powers: indigo -->
    <marker id="${uid}-pw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#4f46e5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
    <!-- controls: purple -->
    <marker id="${uid}-ct" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#7c3aed" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
    <!-- cools: cyan -->
    <marker id="${uid}-cl" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M2 1L8 5L2 9" fill="none" stroke="#0284c7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>

  <!-- ════════════════════════════════════════════════════════
       CONNECTIONS
       Layout centres:
         VCU-001  cx=540  y=30
         ICE-001  cx=100  y=150   GB-001  cx=280  y=150
         PCU-001  cx=630  y=150   BAT-001 cx=920  y=150
         EM-001   cx=100  y=275   DIFF-F  cx=300  y=275
         DIFF-R   cx=720  y=275   EM-002  cx=940  y=275
         COOL-M   cx=360  y=395   COOL-B  cx=790  y=395
       ════════════════════════════════════════════════════════ -->

  <!-- VCU controls ICE-001 -->
  <path d="M480,76 L480,110 L100,110 L100,150"
        fill="none" stroke="#7c3aed" stroke-width="1.5" marker-end="url(#${uid}-ct)"/>
  <!-- VCU controls PCU-001 -->
  <path d="M560,76 L560,110 L630,110 L630,150"
        fill="none" stroke="#7c3aed" stroke-width="1.5" marker-end="url(#${uid}-ct)"/>
  <!-- VCU controls DIFF-R (torque vectoring) -->
  <path d="M620,53 C900,53 1000,160 940,275"
        fill="none" stroke="#7c3aed" stroke-width="1" stroke-dasharray="5 3" marker-end="url(#${uid}-ct)"/>

  <!-- ICE-001 drives GB-001 -->
  <line x1="160" y1="173" x2="210" y2="173"
        stroke="#059669" stroke-width="2" marker-end="url(#${uid}-dr)"/>
  <!-- GB-001 drives DIFF-F -->
  <path d="M280,196 L280,240 L300,240 L300,275"
        fill="none" stroke="#059669" stroke-width="2" marker-end="url(#${uid}-dr)"/>

  <!-- BAT-001 powers PCU-001 -->
  <line x1="830" y1="173" x2="710" y2="173"
        stroke="#4f46e5" stroke-width="2" marker-end="url(#${uid}-pw)"/>

  <!-- PCU-001 powers EM-001 (long arc across top) -->
  <path d="M560,163 L560,130 L100,130 L100,275"
        fill="none" stroke="#4f46e5" stroke-width="1.5" marker-end="url(#${uid}-pw)"/>
  <!-- PCU-001 powers EM-002 -->
  <path d="M710,163 L710,130 L940,130 L940,275"
        fill="none" stroke="#4f46e5" stroke-width="1.5" marker-end="url(#${uid}-pw)"/>

  <!-- EM-001 drives DIFF-F -->
  <line x1="160" y1="298" x2="230" y2="298"
        stroke="#059669" stroke-width="2" marker-end="url(#${uid}-dr)"/>
  <!-- EM-002 drives DIFF-R -->
  <line x1="880" y1="298" x2="800" y2="298"
        stroke="#059669" stroke-width="2" marker-end="url(#${uid}-dr)"/>

  <!-- COOL-M cools EM-001 -->
  <path d="M260,395 L260,360 L100,360 L100,321"
        fill="none" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="5 3" marker-end="url(#${uid}-cl)"/>
  <!-- COOL-M cools PCU-001 -->
  <path d="M460,395 L460,370 L630,370 L630,196"
        fill="none" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="5 3" marker-end="url(#${uid}-cl)"/>
  <!-- COOL-M cools EM-002 -->
  <path d="M460,415 L940,415 L940,321"
        fill="none" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="5 3" marker-end="url(#${uid}-cl)"/>
  <!-- COOL-B cools BAT-001 -->
  <path d="M790,395 L920,395 L920,196"
        fill="none" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="5 3" marker-end="url(#${uid}-cl)"/>

  <!-- edge labels -->
  <text x="188" y="168" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#059669">drives</text>
  <text x="857" y="168" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#4f46e5">powers</text>
  <text x="188" y="293" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#059669">drives</text>
  <text x="862" y="293" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#059669">drives</text>

  <!-- ════════════════════════════════════════════════════════
       ROW 0 — VCU-001  x=460 y=30 w=160
       ════════════════════════════════════════════════════════ -->
  <g class="ag-eq" data-id="VCU-001">
    <rect class="ag-bg" x="460" y="30" width="160" height="46" rx="9" fill="#eae8fc" stroke="#3730a3" stroke-width="1"/>
    <text x="540" y="50" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#2c2680">VCU-001</text>
    <text x="540" y="65" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#3730a3">Vehicle Control Unit</text>
    <rect x="598" y="32" width="18" height="14" rx="3" fill="white" stroke="#3730a3" stroke-width="0.5"/>
    <text x="607" y="39" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#2c2680">3</text>
  </g>

  <!-- ════════════════════════════════════════════════════════
       ROW 1 — y=150
       ICE-001 x=20  GB-001 x=210  PCU-001 x=550  BAT-001 x=830
       ════════════════════════════════════════════════════════ -->
  <g class="ag-eq" data-id="ICE-001">
    <rect class="ag-bg" x="20" y="150" width="160" height="46" rx="9" fill="#fef3c7" stroke="#d97706" stroke-width="1"/>
    <text x="100" y="170" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#92400e">ICE-001</text>
    <text x="100" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#b45309">2.0T Petrol Engine</text>
    <rect x="158" y="152" width="18" height="14" rx="3" fill="white" stroke="#d97706" stroke-width="0.5"/>
    <text x="167" y="159" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#92400e">3</text>
  </g>

  <g class="ag-eq" data-id="GB-001">
    <rect class="ag-bg" x="210" y="150" width="140" height="46" rx="9" fill="#d1fae5" stroke="#059669" stroke-width="1"/>
    <text x="280" y="170" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#065f46">GB-001</text>
    <text x="280" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#059669">8-Speed DCT</text>
    <rect x="328" y="152" width="18" height="14" rx="3" fill="white" stroke="#059669" stroke-width="0.5"/>
    <text x="337" y="159" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#065f46">2</text>
  </g>

  <g class="ag-eq" data-id="PCU-001">
    <rect class="ag-bg" x="550" y="150" width="160" height="46" rx="9" fill="#e0e7ff" stroke="#4f46e5" stroke-width="1"/>
    <text x="630" y="170" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#3730a3">PCU-001</text>
    <text x="630" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#4f46e5">Power Control Unit</text>
    <rect x="688" y="152" width="18" height="14" rx="3" fill="white" stroke="#4f46e5" stroke-width="0.5"/>
    <text x="697" y="159" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#3730a3">2</text>
  </g>

  <g class="ag-eq" data-id="BAT-001">
    <rect class="ag-bg" x="740" y="150" width="180" height="46" rx="9" fill="#fef9c3" stroke="#b45309" stroke-width="1"/>
    <text x="830" y="170" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#78350f">BAT-001</text>
    <text x="830" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#b45309">18.4 kWh HV Battery</text>
    <rect x="898" y="152" width="18" height="14" rx="3" fill="white" stroke="#b45309" stroke-width="0.5"/>
    <text x="907" y="159" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#78350f">3</text>
  </g>

  <!-- ════════════════════════════════════════════════════════
       ROW 2 — y=275
       EM-001 x=20   DIFF-F x=230   DIFF-R x=640   EM-002 x=870
       ════════════════════════════════════════════════════════ -->
  <g class="ag-eq" data-id="EM-001">
    <rect class="ag-bg" x="20" y="275" width="160" height="46" rx="9" fill="#ede9fe" stroke="#7c3aed" stroke-width="1"/>
    <text x="100" y="295" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#4c1d95">EM-001</text>
    <text x="100" y="310" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#7c3aed">Front Motor 120 kW</text>
    <rect x="158" y="277" width="18" height="14" rx="3" fill="white" stroke="#7c3aed" stroke-width="0.5"/>
    <text x="167" y="284" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#4c1d95">2</text>
  </g>

  <g class="ag-eq" data-id="DIFF-F">
    <rect class="ag-bg" x="230" y="275" width="150" height="46" rx="9" fill="#ccfbf1" stroke="#0f766e" stroke-width="1"/>
    <text x="305" y="295" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#0f4c41">DIFF-F</text>
    <text x="305" y="310" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#0f766e">Front Differential</text>
    <rect x="358" y="277" width="18" height="14" rx="3" fill="white" stroke="#0f766e" stroke-width="0.5"/>
    <text x="367" y="284" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#0f4c41">1</text>
  </g>

  <g class="ag-eq" data-id="DIFF-R">
    <rect class="ag-bg" x="640" y="275" width="160" height="46" rx="9" fill="#ccfbf1" stroke="#0f766e" stroke-width="1"/>
    <text x="720" y="295" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#0f4c41">DIFF-R</text>
    <text x="720" y="310" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#0f766e">Rear Diff (eLSD)</text>
    <rect x="778" y="277" width="18" height="14" rx="3" fill="white" stroke="#0f766e" stroke-width="0.5"/>
    <text x="787" y="284" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#0f4c41">2</text>
  </g>

  <g class="ag-eq" data-id="EM-002">
    <rect class="ag-bg" x="860" y="275" width="160" height="46" rx="9" fill="#ede9fe" stroke="#7c3aed" stroke-width="1"/>
    <text x="940" y="295" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#4c1d95">EM-002</text>
    <text x="940" y="310" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#7c3aed">Rear Motor 100 kW</text>
    <rect x="998" y="277" width="18" height="14" rx="3" fill="white" stroke="#7c3aed" stroke-width="0.5"/>
    <text x="1007" y="284" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#4c1d95">1</text>
  </g>

  <!-- ════════════════════════════════════════════════════════
       ROW 3 — y=395  cooling loops
       COOL-M x=160   COOL-B x=590
       ════════════════════════════════════════════════════════ -->
  <g class="ag-eq" data-id="COOL-M">
    <rect class="ag-bg" x="160" y="395" width="200" height="46" rx="9" fill="#dbeafe" stroke="#0284c7" stroke-width="1"/>
    <text x="260" y="415" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#075985">COOL-M</text>
    <text x="260" y="430" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#0284c7">Motor Cooling Loop</text>
    <rect x="338" y="397" width="18" height="14" rx="3" fill="white" stroke="#0284c7" stroke-width="0.5"/>
    <text x="347" y="404" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#075985">1</text>
  </g>

  <g class="ag-eq" data-id="COOL-B">
    <rect class="ag-bg" x="590" y="395" width="200" height="46" rx="9" fill="#dbeafe" stroke="#0284c7" stroke-width="1"/>
    <text x="690" y="415" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#075985">COOL-B</text>
    <text x="690" y="430" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#0284c7">Battery TMS</text>
    <rect x="768" y="397" width="18" height="14" rx="3" fill="white" stroke="#0284c7" stroke-width="0.5"/>
    <text x="777" y="404" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="600" fill="#075985">1</text>
  </g>

</svg>`;
    this.dom.appendChild(graphWrap);

    // Wire up click handlers
    graphWrap.querySelectorAll('.ag-eq').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => this._sel(el.dataset.id));
    });

    // ── Detail panel ──────────────────────────────────────────────────────────
    this._det = document.createElement('div');
    this._det.className = 'ag-detail';
    this._det.innerHTML = '<div class="ag-hint">↑ Click any component to explore specs, linked documents, and relationships</div>';
    this.dom.appendChild(this._det);

    if (this._cur) this._highlightNode(this._cur);
  }

  _sel(id) {
    if (this._cur) this._highlightNode(this._cur, false);
    this._cur = id;
    this._highlightNode(id, true);
    this._renderDetail(id);
  }

  _highlightNode(id, on = true) {
    const el = this.dom.querySelector(`.ag-eq[data-id="${id}"]`);
    if (!el) return;
    const bg = el.querySelector('.ag-bg');
    if (bg) {
      bg.style.filter      = on ? 'drop-shadow(0 0 6px rgba(0,0,0,.22))' : '';
      bg.style.strokeWidth = on ? '2.5' : '';
    }
  }

  _renderDetail(id) {
    const d = EQUIPMENT[id];
    if (!d) return;

    const attrs = d.attrs.map(([k, v]) => `
      <div class="ag-attr"><div class="ag-al">${k}</div><div class="ag-av">${v}</div></div>`
    ).join('');

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

    const existingDocId = (this.node.attrs.equipmentDocs || {})[id];
    const openLabel     = existingDocId ? 'Open document →' : 'Create document →';
    const hasSubgraph   = !!SUBGRAPHS[id];

    this._det.innerHTML = `
      <div class="ag-det-header">
        <div>
          <div><span class="ag-did">${id}</span><span class="ag-cat">${d.cat}</span></div>
          <div class="ag-dfull">${d.full} · <em>${d.type}</em></div>
        </div>
        <div class="ag-det-actions">
          <div class="ag-sta"><span class="ag-dot" style="background:${d.sc}"></span>${d.sl}</div>
          <button class="ag-open-btn" data-eq="${id}">${openLabel}</button>
          ${hasSubgraph ? `<button class="ag-sg-btn" data-eq="${id}">Insert subgraph ↓</button>` : ''}
        </div>
      </div>
      <div class="ag-sec">Technical specifications</div>
      <div class="ag-attrs">${attrs}</div>
      <div class="ag-sec">Linked documents (${d.docs.length})</div>
      <div class="ag-docs">${docs}</div>
      <div class="ag-sec">Relationships (${d.rels.length})</div>
      <div class="ag-rels">${rels}</div>`;

    this._det.querySelector('.ag-open-btn').addEventListener('click', () => {
      this._openComponentDoc(id);
    });

    const sgBtn = this._det.querySelector('.ag-sg-btn');
    if (sgBtn) {
      sgBtn.addEventListener('click', () => this._insertSubgraph(id));
    }
  }

  async _openComponentDoc(id) {
    const d = EQUIPMENT[id];
    if (!d) return;

    const btn = this._det.querySelector('.ag-open-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }

    const equipmentDocs = { ...(this.node.attrs.equipmentDocs || {}) };
    let docId = equipmentDocs[id];

    if (!docId) {
      docId = randomId();
      const initialJSON = this._buildComponentDoc(id, d);
      await docStore.create(docId, `${id} — ${d.full}`, initialJSON);

      equipmentDocs[id] = docId;
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(
          this.getPos(), null,
          { ...this.node.attrs, equipmentDocs },
        )
      );
    }

    window.location.href = `/?id=${docId}`;
  }

  _buildComponentDoc(id, d) {
    const txt     = (text, marks) => { const n = { type:'text', text }; if (marks?.length) n.marks = marks; return n; };
    const para    = (...c) => ({ type:'paragraph', content: c });
    const emptyP  = ()    => ({ type:'paragraph', content: [] });
    const heading = (level, text) => ({ type:'heading', attrs:{ level }, content:[{ type:'text', text }] });
    const bullet  = items => ({
      type: 'bullet_list',
      content: items.map(text => ({
        type: 'list_item',
        content: [para(txt(text))],
      })),
    });
    const hr = () => ({ type:'horizontal_rule' });

    return {
      type: 'doc',
      content: [
        heading(1, `${id} — ${d.full}`),
        para(txt(`${d.type}  ·  ${d.cat}  ·  `), txt(d.sl, [{ type:'strong' }])),
        hr(),
        heading(2, 'Technical Specifications'),
        bullet(d.attrs.map(([k, v]) => `${k}: ${v}`)),
        heading(2, `Linked Documents (${d.docs.length})`),
        bullet(d.docs.map(x => `[${x.e}] ${x.n} — ${x.d}`)),
        heading(2, `Relationships (${d.rels.length})`),
        bullet(d.rels.map(r => `${r.d} ${r.t} → ${r.p}`)),
        hr(),
        heading(2, 'Engineering Notes'),
        emptyP(),
      ],
    };
  }

  // Insert a SubGraph block immediately after this CarGraph node
  _insertSubgraph(id) {
    const sg = SUBGRAPHS[id];
    if (!sg) return;

    const { state, dispatch } = this.view;
    const nodeType = state.schema.nodes.subGraph;
    if (!nodeType) return;

    const sgNode    = nodeType.create({
      title:     sg.title,
      parentId:  id,
      graphType: 'component',
      nodes:     sg.nodes,
      edges:     sg.edges,
    });

    // Insert right after this node in the document
    const insertPos = this.getPos() + this.node.nodeSize;
    dispatch(state.tr.insert(insertPos, sgNode).scrollIntoView());
  }

  // ── ProseMirror NodeView interface ─────────────────────────────────────────
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const hdr = this.dom.querySelector('.ag-title');
    if (hdr) hdr.textContent = node.attrs.title;
    return true;
  }
  stopEvent()      { return true; }
  ignoreMutation() { return true; }
  destroy()        {}
}
