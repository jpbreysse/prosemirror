/**
 * schema.js
 *
 * Defines the document schema — the "grammar" of your editor.
 * Extend nodes and marks here as your editor grows.
 */

import { Schema } from "prosemirror-model";
import { nodes as basicNodes, marks as basicMarks } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { tableNodes } from "prosemirror-tables";
import OrderedMap from "orderedmap";

// addListNodes requires an OrderedMap; wrap the plain-object export from
// prosemirror-schema-basic so it has the .append() method it needs.
const withLists = addListNodes(OrderedMap.from(basicNodes), "paragraph block*", "block");

// ------------------------------------------------------------------
// Graph node — an atomic block rendered by GraphNodeView (Chart.js)
// ------------------------------------------------------------------
const graphNodeSpec = {
  group: "block",
  atom: true, // treated as a single unit; cursor cannot enter it
  attrs: {
    chartType: { default: "bar" },          // bar | line | pie | doughnut
    title:     { default: "My Chart" },
    labels:    { default: ["Jan", "Feb", "Mar", "Apr"] },
    data:      { default: [12, 19, 8, 15] },
    color:     { default: "#6366f1" },
  },
  parseDOM: [{
    tag: "div[data-graph]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-graph")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-graph": JSON.stringify(node.attrs) }, 0];
  },
};

// ------------------------------------------------------------------
// Map node — an atomic block rendered by MapNodeView (Leaflet.js)
// ------------------------------------------------------------------
const mapNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    lat:     { default: 48.8566 },   // Paris by default
    lng:     { default: 2.3522 },
    zoom:    { default: 13 },
    height:  { default: 300 },       // px
    caption: { default: "" },
  },
  parseDOM: [{
    tag: "div[data-map]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-map")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-map": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// Diagram node — an atomic block rendered by DiagramNodeView (Cytoscape.js)
// Stores nodes[] and edges[] as plain JSON so ProseMirror can serialize them.
// ------------------------------------------------------------------
const diagramNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    nodes: { default: [
      { id: "1", label: "Start",   x: 150, y: 80  },
      { id: "2", label: "Process", x: 150, y: 200 },
      { id: "3", label: "End",     x: 150, y: 320 },
    ]},
    edges: { default: [
      { id: "e1", source: "1", target: "2" },
      { id: "e2", source: "2", target: "3" },
    ]},
    layout:  { default: "preset" }, // preset | breadthfirst | circle | cose | grid
    height:  { default: 400 },
    caption: { default: "" },
  },
  parseDOM: [{
    tag: "div[data-diagram]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-diagram")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-diagram": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// Product node — an atomic block rendered by ProductNodeView (pure DOM)
// Stores the full product configuration so it round-trips cleanly.
// ------------------------------------------------------------------
const productNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    name:        { default: "Running Shoe Pro" },
    description: { default: "Lightweight running shoe with responsive cushioning and a durable grip sole." },
    image:       { default: "" },       // URL — empty = show colour placeholder
    basePrice:   { default: 129 },
    currency:    { default: "€" },
    colors: { default: [
      { id: "blue",  label: "Ocean Blue", hex: "#3b82f6", modifier: 0  },
      { id: "red",   label: "Crimson",    hex: "#ef4444", modifier: 10 },
      { id: "green", label: "Forest",     hex: "#22c55e", modifier: 0  },
      { id: "black", label: "Midnight",   hex: "#1c1917", modifier: 5  },
    ]},
    sizes:     { default: ["38","39","40","41","42","43","44","45"] },
    materials: { default: [
      { id: "standard", label: "Standard", modifier: 0  },
      { id: "premium",  label: "Premium",  modifier: 25 },
      { id: "eco",      label: "Eco",      modifier: 15 },
    ]},
    selectedColor:    { default: "blue" },
    selectedSize:     { default: "42" },
    selectedMaterial: { default: "standard" },
    quantity:         { default: 1 },
  },
  parseDOM: [{
    tag: "div[data-product]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-product")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-product": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// FHIR node — atomic block that fetches + renders a FHIR resource
// Supported resourceTypes: Patient | Observation | MedicationStatement
// ------------------------------------------------------------------
const fhirNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    resourceType: { default: "Patient" },
    resourceId:   { default: "" },
    serverUrl:    { default: "https://hapi.fhir.org/baseR4" },
    resource:     { default: null },   // raw FHIR JSON once fetched
    status:       { default: "idle" }, // idle | loading | loaded | error
    error:        { default: "" },
  },
  parseDOM: [{
    tag: "div[data-fhir]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-fhir")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-fhir": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// Form node — an atomic block with two modes:
//   "edit"  → author adds/removes/configures fields
//   "fill"  → reader fills in and submits the form
//
// All fields are stored as a JSON array in attrs so the full form
// definition round-trips cleanly in the ProseMirror document.
// ------------------------------------------------------------------
const formNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:       { default: "Untitled Form" },
    description: { default: "" },
    submitLabel: { default: "Submit" },
    mode:        { default: "edit" },   // "edit" | "fill"
    fields: { default: [
      { id: "f1", type: "text",     label: "Name",    placeholder: "Your name",    required: true,  options: [] },
      { id: "f2", type: "email",    label: "Email",   placeholder: "your@email.com", required: true, options: [] },
      { id: "f3", type: "textarea", label: "Message", placeholder: "Your message", required: false, options: [] },
    ]},
  },
  parseDOM: [{
    tag: "div[data-form]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-form")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-form": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// Kanban node — a full Jira-like board with columns + issue cards.
// Columns and issues are stored as JSON arrays in attrs so the whole
// board round-trips cleanly inside the ProseMirror document.
// ------------------------------------------------------------------
const kanbanNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title: { default: "Sprint Board" },
    columns: { default: [
      { id: "todo",   title: "To Do",        color: "#e4e4e7" },
      { id: "inprog", title: "In Progress",  color: "#fef08a" },
      { id: "review", title: "Review",       color: "#bfdbfe" },
      { id: "done",   title: "Done",         color: "#bbf7d0" },
    ]},
    issues: { default: [
      { id: "ISS-1", title: "Set up project structure", columnId: "done",   priority: "medium", assignee: "",     labels: ["setup"],    description: "Initialise repo, install deps." },
      { id: "ISS-2", title: "Build navigation bar",     columnId: "inprog", priority: "high",   assignee: "marie",labels: ["frontend"], description: "Responsive top nav with links." },
      { id: "ISS-3", title: "Write unit tests",         columnId: "todo",   priority: "high",   assignee: "jean", labels: ["qa"],       description: "Cover all utility functions." },
      { id: "ISS-4", title: "Design system tokens",     columnId: "todo",   priority: "low",    assignee: "",     labels: ["design"],   description: "" },
    ]},
    nextId: { default: 5 },
  },
  parseDOM: [{
    tag: "div[data-kanban]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-kanban")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-kanban": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// AssetGraph node — the ArborSpace cooling-water interactive SVG graph.
// atom: true — the entire block is a single opaque unit.
// Only "system" and "title" are stored; all equipment data lives in
// the NodeView so the serialised doc stays small.
// ------------------------------------------------------------------
const assetGraphNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    system:        { default: "CW-101" },
    title:         { default: "Cooling Water System — CW-101" },
    equipmentDocs: { default: {} }, // { 'CT-101': '<uuid>', 'P-101A': '<uuid>', … }
  },
  parseDOM: [{
    tag: "div[data-asset-graph]",
    getAttrs(dom) {
      try { return JSON.parse(dom.getAttribute("data-asset-graph")); }
      catch { return {}; }
    },
  }],
  toDOM(node) {
    return ["div", { "data-asset-graph": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// Reply node — an attributed comment/reply block.
// Non-atom: ProseMirror manages the content (paragraph+) natively.
// The NodeView adds the author header above the content hole.
// ------------------------------------------------------------------
const replyNodeSpec = {
  content: "paragraph+",
  group: "block",
  defining: true,
  attrs: {
    author:    { default: "Anonymous" },
    color:     { default: "#6366f1" },
    timestamp: { default: "" },
  },
  toDOM(node) {
    return ["div", {
      class:            "reply-block",
      "data-author":    node.attrs.author,
      "data-color":     node.attrs.color,
      "data-timestamp": node.attrs.timestamp,
    }, 0];
  },
  parseDOM: [{ tag: "div.reply-block", getAttrs(dom) {
    return {
      author:    dom.dataset.author    || "Anonymous",
      color:     dom.dataset.color     || "#6366f1",
      timestamp: dom.dataset.timestamp || "",
    };
  }}],
};

// ------------------------------------------------------------------
// ImageBlock node — uploadable image with caption and alignment.
// ------------------------------------------------------------------
const imageBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    src:     { default: "" },        // URL (local /uploads/… or external)
    alt:     { default: "" },        // alt text / filename stem
    caption: { default: "" },
    align:   { default: "center" },  // "left" | "center" | "right"
    width:   { default: "100%" },    // "30%" | "50%" | "75%" | "100%"
  },
  parseDOM: [{ tag: "figure[data-image-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-image-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["figure", { "data-image-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// GraphBuilder node — free-form interactive graph editor.
// ------------------------------------------------------------------
const graphBuilderNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:      { default: "Graph" },
    directed:   { default: true },
    nodes:      { default: [] },   // [{ id, label, x, y, color }]
    edges:      { default: [] },   // [{ id, source, target, label }]
    nextId:     { default: 1 },
    nextEdgeId: { default: 1 },
  },
  parseDOM: [{ tag: "div[data-graph-builder]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-graph-builder")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-graph-builder": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// MarkdownBlock node — edit/preview markdown block.
// ------------------------------------------------------------------
const markdownBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    content:  { default: "" },   // raw markdown string
    filename: { default: "" },   // optional label e.g. "README.md"
  },
  parseDOM: [{ tag: "div[data-markdown-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-markdown-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-markdown-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// MeetingNotes node — structured meeting record block.
// ------------------------------------------------------------------
const meetingNotesNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:     { default: "New Meeting" },
    date:      { default: "" },          // datetime-local string
    location:  { default: "" },
    attendees: { default: [] },          // [{ id, name, role, present }]
    agenda:    { default: [] },          // [{ id, text, done }]
    actions:   { default: [] },          // [{ id, text, owner, due, status }]
    notes:     { default: "" },
  },
  parseDOM: [{ tag: "div[data-meeting-notes]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-meeting-notes")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-meeting-notes": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// SubGraph node — generic data-driven component subgraph.
// Inserted inline when drilling down into a car-graph component.
// nodes/edges are stored as JSON arrays so the diagram round-trips.
// ------------------------------------------------------------------
const subGraphNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:         { default: "Component Subgraph" },
    parentId:      { default: "" },      // e.g. "EM-001"
    graphType:     { default: "generic" },
    nodes:         { default: [] },      // [{ id, label, sublabel, color, border }]
    edges:         { default: [] },      // [{ source, target, type, label }]
    equipmentDocs: { default: {} },      // reserved for future per-node doc links
  },
  parseDOM: [{ tag: "div[data-subgraph]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-subgraph")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-subgraph": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// CustomerBlock node — live CRM card connected to Customer API.
// ------------------------------------------------------------------
const customerBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    customerId:   { default: "" },      // UUID — empty = unconfigured / search state
    data:         { default: null },    // cached customer JSON
    assets:       { default: [] },      // cached assets array
    interactions: { default: [] },      // cached interactions array
    status:       { default: "idle" },  // idle | loading | synced | error
    lastSync:     { default: null },
    activeTab:    { default: "assets" },
    error:        { default: "" },
  },
  parseDOM: [{ tag: "div[data-customer-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-customer-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-customer-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// RiskMatrix node — 5×5 Likelihood × Impact risk assessment block.
// ------------------------------------------------------------------
const riskMatrixNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:      { default: "Risk Assessment" },
    objectName: { default: "Battery Pack BMS-001" },
    objectType: { default: "equipment" },
    metrics: { default: [
      { id: "rm_d1", name: "Cell Temperature",      value: "72",  unit: "°C",    likelihood: 3, impact: 4, notes: "Elevated temp in cell block C3" },
      { id: "rm_d2", name: "State of Charge",       value: "15",  unit: "%",     likelihood: 4, impact: 5, notes: "Below minimum safe threshold" },
      { id: "rm_d3", name: "Insulation Resistance", value: "1.2", unit: "MΩ",    likelihood: 2, impact: 3, notes: "Within spec but degrading" },
      { id: "rm_d4", name: "Cooling Flow",          value: "2.1", unit: "L/min", likelihood: 3, impact: 3, notes: "Reduced since last inspection" },
      { id: "rm_d5", name: "Thermal Runaway Index", value: "0.31",unit: "",      likelihood: 2, impact: 5, notes: "Early indicator — monitor closely" },
    ]},
  },
  parseDOM: [{ tag: "div[data-risk-matrix]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-risk-matrix")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-risk-matrix": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// MoleculeBlock node — 2D chemical structure rendered from SMILES.
// ------------------------------------------------------------------
const moleculeBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    smiles:  { default: "" },         // SMILES string, e.g. "CCO"
    caption: { default: "" },
    theme:   { default: "light" },    // "light" | "dark"
    width:   { default: "100%" },     // "50%" | "75%" | "100%"
  },
  parseDOM: [{ tag: "div[data-molecule-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-molecule-block")); }
    catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-molecule-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// CarGraph node — PHEV drivetrain interactive architecture diagram.
// ------------------------------------------------------------------
const carGraphNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title:         { default: "EV-200 PHEV Drivetrain Architecture" },
    equipmentDocs: { default: {} },
  },
  parseDOM: [{ tag: "div[data-car-graph]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-car-graph")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-car-graph": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// ClauseBlock — links to a live clause from the LexAPI clause library.
// ------------------------------------------------------------------
const clauseBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    clauseId: { default: null },   // UUID from LexAPI
    data:     { default: null },   // full clause JSON blob from API
    status:   { default: "search" }, // "search" | "loading" | "loaded" | "error"
    error:    { default: null },
  },
  parseDOM: [{ tag: "div[data-clause-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-clause-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-clause-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// PartyBlock — links to a legal party from the LexAPI party registry.
// ------------------------------------------------------------------
const partyBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    partyId: { default: null },     // UUID from LexAPI
    data:    { default: null },     // full party object cached from API
    status:  { default: "search" }, // "search" | "loading" | "loaded" | "error"
    error:   { default: null },
  },
  parseDOM: [{ tag: "div[data-party-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-party-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-party-block": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// VersionTimeline — inline block showing the document's version history.
// No meaningful attrs — the block derives docId from the URL at runtime.
// ------------------------------------------------------------------
const versionTimelineNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    title: { default: "Version Timeline" },
  },
  parseDOM: [{ tag: "div[data-version-timeline]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-version-timeline")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-version-timeline": JSON.stringify(node.attrs) }];
  },
};

// ------------------------------------------------------------------
// MatterBlock — links to a legal matter from the LexAPI matter registry.
// ------------------------------------------------------------------
const matterBlockNodeSpec = {
  group: "block",
  atom: true,
  attrs: {
    matterId: { default: null },
    data:     { default: null },     // full matter JSON blob
    status:   { default: "search" }, // "search" | "loading" | "loaded" | "error"
    error:    { default: null },
  },
  parseDOM: [{ tag: "div[data-matter-block]", getAttrs(dom) {
    try { return JSON.parse(dom.getAttribute("data-matter-block")); } catch { return {}; }
  }}],
  toDOM(node) {
    return ["div", { "data-matter-block": JSON.stringify(node.attrs) }];
  },
};

const withCustom = withLists.append({
  graph: graphNodeSpec,
  map: mapNodeSpec,
  diagram: diagramNodeSpec,
  product: productNodeSpec,
  fhir: fhirNodeSpec,
  form: formNodeSpec,
  kanban: kanbanNodeSpec,
  reply: replyNodeSpec,
  assetGraph: assetGraphNodeSpec,
  carGraph:   carGraphNodeSpec,
  subGraph:      subGraphNodeSpec,
  meetingNotes:   meetingNotesNodeSpec,
  markdownBlock:  markdownBlockNodeSpec,
  graphBuilder:   graphBuilderNodeSpec,
  imageBlock:     imageBlockNodeSpec,
  moleculeBlock:  moleculeBlockNodeSpec,
  riskMatrix:     riskMatrixNodeSpec,
  customerBlock:  customerBlockNodeSpec,
  clauseBlock:      clauseBlockNodeSpec,
  partyBlock:       partyBlockNodeSpec,
  matterBlock:      matterBlockNodeSpec,
  versionTimeline:  versionTimelineNodeSpec,
});

const nodes = withCustom.append(tableNodes({ tableGroup: "block", cellContent: "block+" }));

export const schema = new Schema({ nodes, marks: basicMarks });
