import { useEffect, useRef } from "react";
import type { Cell } from "../../domain/works";
import { mountSheets, type MountedSheetsHandle, type SheetLabels } from "./mountSheets";

export type { SheetLabels };

export interface SheetWorkbenchProps {
  columns: string[];
  rows: Cell[][];
  documentTitle?: string;
  readOnly?: boolean;
  resetKey?: string | number;
  labels: SheetLabels;
  onChange: (next: { columns: string[]; rows: Cell[][] }) => void;
}

export function SheetWorkbench({
  columns,
  rows,
  documentTitle,
  readOnly = false,
  resetKey,
  labels,
  onChange,
}: SheetWorkbenchProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MountedSheetsHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const initialColsRef = useRef(columns);
  initialColsRef.current = columns;
  const initialRowsRef = useRef(rows);
  initialRowsRef.current = rows;
  const initialTitleRef = useRef(documentTitle);
  initialTitleRef.current = documentTitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountSheets({
      host,
      columns: initialColsRef.current,
      rows: initialRowsRef.current,
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
    handleRef.current?.updateExternal(columns, rows, documentTitle);
  }, [columns, rows, documentTitle]);

  return <div ref={hostRef} className="cfos-workbench-host" />;
}
