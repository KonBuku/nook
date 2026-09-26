import { useTransform, useSpring, motion, type MotionValue } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { Layout, flareInset } from "~/design/layout";
import type { Shape } from "~/design/shapes";
import { unfoldSpring } from "~/design/motion";
import { Palette } from "~/design/palette";
import { notchPath } from "~/design/notchPath";

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
  dragging,
  onPaint,
  closed,
  open,
  ring,
  closedSize,
  openSize,
}: {
  shape: Shape;
  isOpen: boolean;
  /** Being carried along the edge: follow the cursor, do not animate. */
  dragging: boolean;
  /**
   * Where the shape actually is, on every frame it moves.
   *
   * `top` rather than a centre, because that is what the springs hold. Called
   * from the motion values themselves rather than from the target shape: the
   * region cut around the notch has to follow what is *painted*, and between
   * one target and the next there is a spring's worth of travel that is at
   * neither of them.
   */
  onPaint?: (width: number, height: number, top: number) => void;
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
    const top = shape.centerY - shape.height / 2;

    // `jump` while a drag is in progress, which sets the value and abandons the
    // animation rather than starting one towards it.
    //
    // The spring is what makes an opening notch feel like an object. Under a
    // drag it is the opposite: the thing is supposed to be held, and a 420ms
    // spring chasing the cursor renders that as the notch sloshing along
    // behind it. Near the top or bottom of the screen it is worse still —
    // there the window has run out of room and *all* of the travel is the
    // notch moving inside it, so all of it is spring.
    if (dragging) {
      width.jump(shape.width);
      height.jump(shape.height);
      y.jump(top);
      return;
    }

    width.set(shape.width);
    height.set(shape.height);
    y.set(top);
  }, [shape.width, shape.height, shape.centerY, dragging, width, height, y]);

  // Every frame the shape moves, and none where it does not. At rest this
  // subscribes to three values that never fire; a drag away from the screen's
  // ends moves the window rather than the shape, so it stays silent there too.
  useEffect(() => {
    if (!onPaint) return;
    const push = () => onPaint(width.get(), height.get(), y.get());
    push();
    const stop = [width.on("change", push), height.on("change", push), y.on("change", push)];
    return () => stop.forEach((off) => off());
  }, [width, height, y, onPaint]);

  const path = useTransform<number, string>([width, height], (latest) =>
    notchPath({
      width: latest[0] ?? 0,
      height: latest[1] ?? 0,
      curl: Layout.curlRadius,
      corner: Layout.cornerRadius,
    }),
  );

  // The same path again, as a clip for everything drawn inside the shape.
  const clip = useTransform(path, (d) => `path("${d}")`);

  return (
    <motion.div className="chrome" style={{ width, height, y }}>
      <Silhouette width={width} height={height} path={path} />

      {/*
        Clipped to the silhouette, not to the box that holds it.

        It used to clip to the box, on the reasoning that the panel's own
        padding kept its contents clear of the flares anyway. That is true of
        the shape at rest and false throughout the animation: the layout is
        held at its *final* size while the box is still travelling, so early in
        an unfold a full-height panel sits in a box a third of that tall and
        hangs out of both ends — the title and the plan beside it, drawn in
        mid-air above the notch for a fifth of a second on every hover.

        Insetting by a flare at each end fixes that much and still leaves the
        four rounded corners, where a bar reaches past the radius into nothing.
        The path has no such gap between what it clips and what is painted:
        it *is* what is painted, driven by the same two motion values, so there
        is no size at which the two can disagree.

        `overflow` as well, which costs nothing and bounds the layout for the
        session list's own scrolling.
      */}
      <motion.div
        style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: clip }}
      >
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
      </motion.div>
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
