let _seq = 0;
function uid() { return `mt-${Date.now()}-${++_seq}`; }

// Today + N days
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_TASKS = [
  {
    id: uid(), component_id: "", component_name: "Oil filter",
    task_type: "Replacement", scheduled_date: daysFromNow(14),
    interval_days: 180, status: "planned",
  },
  {
    id: uid(), component_id: "", component_name: "Drive belt",
    task_type: "Inspection", scheduled_date: daysFromNow(30),
    interval_days: 365, status: "planned",
  },
  {
    id: uid(), component_id: "", component_name: "Brake pad",
    task_type: "Check", scheduled_date: daysFromNow(-5),  // overdue example
    interval_days: 90, status: "planned",
  },
  {
    id: uid(), component_id: "", component_name: "Tire",
    task_type: "Lubrication", scheduled_date: daysFromNow(60),
    interval_days: 180, status: "done",
  },
];

export function insertMaintenanceBlock(tasks = DEFAULT_TASKS) {
  return (state, dispatch) => {
    const type = state.schema.nodes.maintenanceBlock;
    if (!type) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .replaceSelectionWith(type.create({ title: "Maintenance Schedule", tasks }))
          .scrollIntoView()
      );
    }
    return true;
  };
}
