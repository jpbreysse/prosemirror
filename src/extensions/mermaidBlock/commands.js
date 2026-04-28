const DEFAULT_DIAGRAM = `flowchart TB
    Interval["Interval\\nDaily / Weekly / Annual"]
    Pump["Centrifugal pump\\nclass"]
    Task["Maintenance task"]
    Part["Part\\nBearings · Seals · Impeller · Coupling"]
    Failure["Failure mode"]
    Method["Method\\nVisual · Vibration · Thermal · Oil analysis"]

    Pump -->|has_task| Task
    Task -->|scheduled_at| Interval
    Task -->|applies_to| Part
    Task -->|detects| Failure
    Task -->|uses| Method`;

export function insertMermaidBlock(code = DEFAULT_DIAGRAM) {
  return (state, dispatch) => {
    const type = state.schema.nodes.mermaidBlock;
    if (!type) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .replaceSelectionWith(type.create({ code }))
          .scrollIntoView()
      );
    }
    return true;
  };
}
