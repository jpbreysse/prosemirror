/**
 * extensions/reply/nodeView.js
 *
 * Renders a reply/comment block with an attributed header.
 * Uses contentDOM so ProseMirror manages editing inside the block natively.
 */

export class ReplyNodeView {
  constructor(node, view, getPos) {
    this.node   = node;
    this.view   = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "reply-block";
    this.dom.style.setProperty("--reply-color", node.attrs.color);

    // Non-editable header
    this._header = this._buildHeader(node.attrs);
    this.dom.appendChild(this._header);

    // ProseMirror editable content area
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "reply-content";
    this.dom.appendChild(this.contentDOM);
  }

  _buildHeader(attrs) {
    const header = document.createElement("div");
    header.className      = "reply-header";
    header.contentEditable = "false";

    // Avatar: first two initials of each word
    const initials = (attrs.author || "?")
      .split(/\s+/).map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();

    const avatar = document.createElement("span");
    avatar.className  = "reply-avatar";
    avatar.style.background = attrs.color;
    avatar.textContent = initials;

    const nameEl = document.createElement("span");
    nameEl.className  = "reply-author-name";
    nameEl.textContent = attrs.author;

    const timeEl = document.createElement("span");
    timeEl.className  = "reply-timestamp";
    if (attrs.timestamp) {
      timeEl.textContent = new Date(attrs.timestamp).toLocaleString(undefined, {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    }

    header.append(avatar, nameEl, timeEl);
    return header;
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Rebuild header only if attrs changed
    const newHeader = this._buildHeader(node.attrs);
    this.dom.replaceChild(newHeader, this._header);
    this._header = newHeader;
    this.dom.style.setProperty("--reply-color", node.attrs.color);
    return true;
  }

  // Only ignore mutations inside the non-editable header
  ignoreMutation(mutation) {
    return this._header.contains(mutation.target) || mutation.target === this._header;
  }
}
