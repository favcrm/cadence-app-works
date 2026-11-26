import { useEffect, useRef } from "react";
import type { DeckSlide } from "../../domain/works";
import {
  mountSlides,
  type MountedSlidesHandle,
  type SlidesLabels,
} from "./mountSlides";

export type { SlidesLabels };

export interface SlidesWorkbenchProps {
  slides: readonly DeckSlide[];
  documentTitle?: string;
  readOnly: boolean;
  resetKey: number;
  labels: SlidesLabels;
  onChange: (next: DeckSlide[]) => void;
}

export function SlidesWorkbench({
  slides,
  documentTitle,
  readOnly,
  resetKey,
  labels,
  onChange,
}: SlidesWorkbenchProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MountedSlidesHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const initialSlidesRef = useRef(slides);
  initialSlidesRef.current = slides;
  const initialTitleRef = useRef(documentTitle);
  initialTitleRef.current = documentTitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountSlides({
      host,
      slides: initialSlidesRef.current,
      documentTitle: initialTitleRef.current,
      readOnly,
      labels,
      onChange: (next) => onChangeRef.current(next),
    });
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [readOnly, resetKey, labels]);

  useEffect(() => {
    handleRef.current?.updateExternal(slides, documentTitle);
  }, [slides, documentTitle]);

  return <div ref={hostRef} className="cfos-workbench-host" />;
}
