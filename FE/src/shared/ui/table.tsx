import type { HTMLAttributes, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";

/** Native table semantics; selection stays on a real button in each row. */
export function Table(props: TableHTMLAttributes<HTMLTableElement>) { return <table {...props} />; }
export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) { return <thead {...props} />; }
export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) { return <tbody {...props} />; }
export function TableRow(props: HTMLAttributes<HTMLTableRowElement>) { return <tr {...props} />; }
export function TableHead(props: ThHTMLAttributes<HTMLTableCellElement>) { return <th scope="col" {...props} />; }
export function TableCell(props: TdHTMLAttributes<HTMLTableCellElement>) { return <td {...props} />; }
