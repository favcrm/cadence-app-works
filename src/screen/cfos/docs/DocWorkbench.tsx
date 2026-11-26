import { useEffect, useRef } from "react";
import type { DocBlock } from "../../domain/works";
import { mountDocs, type DocLabels, type MountedDocsHandle } from "./mountDocs";

export type { DocLabels };

export interface DocWorkbenchProps {
  blocks: DocBlock[];
  documentTitle?: string;
  readOnly?: boolean;
  resetKey?: string | number;
  labels: DocLabels;
  onChange: (blocks: DocBlock[]) => void;
}

export function DocWorkbench({
  blocks,
  documentTitle,
  readOnly = false,
  resetKey,
  labels,
  onChange,
}: DocWorkbenchProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MountedDocsHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const initialBlocksRef = useRef(blocks);
  initialBlocksRef.current = blocks;
  const initialTitleRef = useRef(documentTitle);
  initialTitleRef.current = documentTitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountDocs({
      host,
      blocks: initialBlocksRef.current,
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
    handleRef.current?.updateExternal(blocks, documentTitle);
  }, [blocks, documentTitle]);

  return <div ref={hostRef} className="cfos-workbench-host" />;
}
