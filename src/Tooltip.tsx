import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type MsgKey } from './i18n';

const SHOW_DELAY_MS = 400;
const GAP = 8;

type TipProps = {
  tipKey: MsgKey;
  params?: Record<string, string | number>;
  children: ReactNode;
  className?: string;
  /** Stretch to fill a grid/flex cell (mode seg, full-width buttons). */
  fill?: boolean;
  preferBelow?: boolean;
};

type Pos = { left: number; top: number; place: 'above' | 'below' };

/**
 * Rich bilingual hover tip. ~400ms delay so scrubbing doesn’t spam;
 * flips above/below at viewport edges; tip has pointer-events: none.
 */
export function Tip({ tipKey, params, children, className, fill, preferBelow }: TipProps) {
  const { t } = useI18n();
  const text = t(tipKey, params);
  const tipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const forceOpen =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('showTip') === tipKey;
  const [open, setOpen] = useState(forceOpen);
  const [pos, setPos] = useState<Pos>({ left: 0, top: 0, place: 'above' });

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const scheduleShow = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    const tip = tipRef.current;
    if (!el || !tip) return;

    const place = () => {
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

      const spaceAbove = r.top;
      const spaceBelow = window.innerHeight - r.bottom;
      let placeSide: 'above' | 'below' = preferBelow ? 'below' : 'above';
      if (preferBelow) {
        if (spaceBelow < th + GAP && spaceAbove > spaceBelow) placeSide = 'above';
      } else if (spaceAbove < th + GAP && spaceBelow > spaceAbove) {
        placeSide = 'below';
      }

      const top = placeSide === 'above' ? r.top - th - GAP : r.bottom + GAP;
      setPos({ left, top, place: placeSide });
    };

    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, text, preferBelow]);

  const tipStyle: CSSProperties = {
    left: pos.left,
    top: pos.top,
  };

  return (
    <span
      ref={triggerRef}
      className={`gw-tip-anchor${fill ? ' fill' : ''}${className ? ` ${className}` : ''}`}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`gw-tip gw-tip-${pos.place}`}
            style={tipStyle}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
