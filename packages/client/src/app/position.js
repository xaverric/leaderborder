export const POPOVER_SIZE = { width: 360, height: 520 };

const MARGIN = 8;
const CLICK_GRACE_MS = 300;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

const hasBounds = (bounds) => Boolean(bounds && bounds.width > 0 && bounds.height > 0);

export const popoverPosition = ({ trayBounds, windowSize, workArea, gap = 6 }) => {
  const minX = workArea.x + MARGIN;
  const maxX = workArea.x + workArea.width - windowSize.width - MARGIN;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - windowSize.height;
  if (!hasBounds(trayBounds)) return { x: Math.round(maxX), y: Math.round(minY + MARGIN) };
  const x = trayBounds.x + trayBounds.width / 2 - windowSize.width / 2;
  const y = trayBounds.y + trayBounds.height + gap;
  return { x: Math.round(clamp(x, minX, maxX)), y: Math.round(clamp(y, minY, maxY)) };
};

export const shouldShowOnClick = ({ visible, lastHiddenAt, now }) =>
  !visible && (lastHiddenAt === null || now - lastHiddenAt >= CLICK_GRACE_MS);
