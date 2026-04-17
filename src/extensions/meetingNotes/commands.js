import { randomId } from "../../store/docStore.js";

export function insertMeetingNotes() {
  return (state, dispatch) => {
    const nodeType = state.schema.nodes.meetingNotes;
    if (!nodeType) return false;

    const now = new Date();
    // datetime-local value format: YYYY-MM-DDTHH:MM
    const pad = n => String(n).padStart(2, "0");
    const dateVal = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const node = nodeType.create({
      title:     "New Meeting",
      date:      dateVal,
      location:  "",
      attendees: [],
      agenda:    [],
      actions:   [],
      notes:     "",
    });

    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
