// Pop-ups are rendered with the Popover API so they sit in the browser's top layer. ha-card clips its content
// (overflow: hidden) and the player is a size container, which traps even position: fixed — at the W size
// (384x188) an in-card dropdown is cut off after two or three rows. Top-layer elements escape both, but are
// positioned against the viewport, so every placement here is in viewport coordinates.

const ANCHOR_GAP = 8;
const VIEWPORT_MARGIN = 12;

// Below the anchor, flipping above when the content doesn't fit below and there's more room above.
// Call once before the popover shows (to avoid a frame at the default centered position), then again once
// it's open and its content can be measured.
export function placeBelowOrAbove(popover: HTMLElement, anchor: DOMRect, left: number, width: number) {
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
  popover.style.width = `${width}px`;
  popover.style.maxHeight = '';
  const contentHeight = popover.scrollHeight;
  if (contentHeight > spaceBelow && spaceAbove > spaceBelow) {
    popover.style.top = 'auto';
    popover.style.bottom = `${viewportHeight - anchor.top + ANCHOR_GAP}px`;
    popover.style.maxHeight = `${spaceAbove}px`;
  } else {
    popover.style.top = `${anchor.bottom + ANCHOR_GAP}px`;
    popover.style.bottom = 'auto';
    popover.style.maxHeight = `${spaceBelow}px`;
  }
}

// Above the anchor, left-aligned with it unless that would run past `rightLimit`, in which case it right-aligns.
export function placeAbove(popover: HTMLElement, anchor: DOMRect, width: number, rightLimit: number) {
  const left = anchor.left + width > rightLimit ? anchor.right - width : anchor.left;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
  popover.style.width = `${width}px`;
  popover.style.top = 'auto';
  popover.style.bottom = `${window.innerHeight - anchor.top + ANCHOR_GAP}px`;
}

export function isOpening(event: Event) {
  return (event as ToggleEvent).newState === 'open';
}
