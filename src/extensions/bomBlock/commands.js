let _seq = 0;
function uid() { return `bom-${Date.now()}-${++_seq}`; }

const DEFAULT_TREE = {
  id:   uid(),
  name: "Machine",
  qty:  1,
  unit: "unit",
  collapsed: false,
  children: [
    {
      id: uid(), name: "Engine", qty: 1, unit: "pcs", collapsed: false,
      children: [
        { id: uid(), name: "Piston",     qty: 4, unit: "pcs", children: [] },
        { id: uid(), name: "Drive belt", qty: 2, unit: "pcs", children: [] },
        { id: uid(), name: "Oil filter", qty: 1, unit: "pcs", children: [] },
      ],
    },
    {
      id: uid(), name: "Wheel", qty: 4, unit: "pcs", collapsed: false,
      children: [
        { id: uid(), name: "Tire",     qty: 1, unit: "pcs", children: [] },
        { id: uid(), name: "Rim",      qty: 1, unit: "pcs", children: [] },
        { id: uid(), name: "Lug nut",  qty: 5, unit: "pcs", children: [] },
      ],
    },
    {
      id: uid(), name: "Brake system", qty: 1, unit: "set", collapsed: false,
      children: [
        { id: uid(), name: "Brake disc", qty: 4, unit: "pcs", children: [] },
        { id: uid(), name: "Brake pad",  qty: 8, unit: "pcs", children: [] },
      ],
    },
  ],
};

export function insertBomBlock(tree = DEFAULT_TREE) {
  return (state, dispatch) => {
    const type = state.schema.nodes.bomBlock;
    if (!type) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .replaceSelectionWith(type.create({ tree }))
          .scrollIntoView()
      );
    }
    return true;
  };
}
