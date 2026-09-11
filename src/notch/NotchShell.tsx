import { useTransform, useSpring, motion, type MotionValue } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { Layout, flareInset } from "~/design/layout";
import { unfoldSpring } from "~/design/motion";
import { Palette } from "~/design/palette";
import { notchPath } from "~/design/notchPath";

export interface Shape {
  width: number;
  /** The whole silhouette, flares included. */
  height: number;
  /**
   * The straight part between the flares — the only part content can sit in.
   * Always `height` less two flare radii; carried alongside rather than derived
   * so the shape and the layout inside it are quoting one number.
   */
  contentHeight: number;
  /** The chrome's vertical centre, from the top of the window. */
  centerY: number;
}

/**
 * The notch's silhouette, and the two layouts that live inside it.
 *
 * Three numbers animate — width, height and where its centre sits — and the
 * path is recomputed from them on every frame. That is deliberate, and it is
 * why the shape is generated rather than authored: morphing between two hand-
 * drawn paths means interpolating point by point, which only works if both
 * have the same points in the same order. Solving the geometry instead means
 * the flares stay the right radius at every size, and the pill's corners do
 * not collapse the way clamped-by-subtraction ones do.
 *
 * The contents are laid out once at their natural size and never move; it is
 * the shape around them that changes. Sizing them to the animating box instead
 * re-lays-them-out on every frame, and the rows visibly drift inside the panel
 * while it opens.
 */
export function NotchShell({
  shape,
  isOpen,
  closed,
  open,
  ring,
  closedSize,
  openSize,
}: {
  shape: Shape;
  isOpen: boolean;
  closed: ReactNode;
  open: ReactNode;
  /** Drawn above both layouts, so it can move between them. */
  ring: ReactNode;
  closedSize: Shape;
  openSize: Shape;
}) {
  const width = useSpring(shape.width, unfoldSpring);
  const height = useSpring(shape.height, unfoldSpring);
  // A transform, not `top`: the notch moves on every open, and `top` is a
  // layout property — the compositor can carry a transform on its own.
  const y = useSpring(shape.centerY - shape.height / 2, unfoldSpring);

  useEffect(() => {
    width.set(shape.width);
    height.set(shape.height);
    y.set(shape.centerY - shape.height / 2);
  }, [shape.width, shape.height, shape.centerY, width, height, y]);

  const path = useTransform<number, string>([width, height], (latest) =>
    notchPath({
      width: latest[0] ?? 0,
      height: latest[1] ?? 0,
      curl: Layout.curlRadius,
      corner: Layout.cornerRadius,
    }),
  );

  return (
    <motion.div className="chrome" style={{ width, height, y }}>
      <Silhouette width={width} height={height} path={path} />

      {/* Clipped by the box, not by the path: everything inside is inset by the
          panel's own padding, which keeps it clear of the flares anyway. */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <Layer size={closedSize} visible={!isOpen}>
          {closed}
        </Layer>
        <Layer size={openSize} visible={isOpen}>
          {open}
        </Layer>

        {/* The body's top edge, which sits one flare in from the shape's own
            top at every size — `contentHeight` is always `height` less two
            flares, so this offset never has to animate. */}
        <div style={{ position: "absolute", left: 0, top: flareInset }}>{ring}</div>
      </div>
    </motion.div>
  );
}

function Silhouette({
  width,
  height,
  path,
}: {
  width: MotionValue<number>;
  height: MotionValue<number>;
  path: MotionValue<string>;
}) {
  return (
    <motion.svg className="silhouette" style={{ width, height }} aria-hidden>
      <motion.path d={path} fill={Palette.surface} />
    </motion.svg>
  );
}

/**
 * One layout, held at its own size and centred in the box.
 *
 * Centred rather than pinned to the top so that a shrinking box takes the same
 * amount off each end — pinned, the panel appears to slide upward out of its
 * own shape as it closes. Centring is also what puts it in the straight part
 * of the shape without any arithmetic: the two flares are the same size, so
 * the middle of the box is the middle of the body.
 */
function Layer({
  size,
  visible,
  children,
}: {
  size: Shape;
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      style={{
        position: "absolute",
        left: 0,
        top: "50%",
        y: "-50%",
        width: size.width,
        height: size.contentHeight,
        pointerEvents: visible ? "auto" : "none",
      }}
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      // Faster than the shape, and out before in: two layouts fading through
      // each other at the same speed spend the middle of the animation as a
      // legible double exposure.
      transition={{ duration: visible ? 0.2 : 0.12, delay: visible ? 0.06 : 0 }}
    >
      {children}
    </motion.div>
  );
}
