import React, { Children, cloneElement, isValidElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sortRows } from '../utils/sorting';
import './Sorting.css';

const elements = (children) => Children.toArray(children).flatMap((child) => (
  child?.type === React.Fragment ? elements(child.props.children) : [child]
));
const text = (children) => elements(children).map((child) => (
  isValidElement(child) ? text(child.props.children) : typeof child === 'string' || typeof child === 'number' ? child : ''
)).join(' ').trim();
const value = (cell) => cell?.props && Object.hasOwn(cell.props, 'data-sort-value')
  ? cell.props['data-sort-value'] : text(cell?.props?.children);

// Tables opt in explicitly. Composite cells provide their primary raw value,
// dates provide ISO values, and durations provide seconds/hours, before formatting.
export default function SortableTable({ children, sortId, ...props }) {
  const [params, setParams] = useSearchParams();
  const key = `${sortId}Sort`;
  const directionKey = `${sortId}Direction`;
  const selected = params.has(key) ? Number(params.get(key)) : -1;
  const direction = params.get(directionKey) === 'desc' ? 'desc' : 'asc';
  const parts = elements(children);
  const head = parts.find((part) => part.type === 'thead');
  const header = elements(head?.props.children)[0];
  const columns = elements(header?.props.children);
  const sortable = (cell) => cell?.type === 'th' && text(cell.props.children) && text(cell.props.children) !== 'Actions' && cell.props['data-sortable'] !== false;
  const active = Number.isInteger(selected) && sortable(columns[selected]);
  const change = (index) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set(key, String(index));
    next.set(directionKey, selected === index && direction === 'asc' ? 'desc' : 'asc');
    return next;
  }, { replace: true });
  return <table {...props}>{parts.map((part) => {
    if (part.type === 'thead') return cloneElement(part, {}, cloneElement(header, {}, columns.map((cell, index) => (
      sortable(cell) ? cloneElement(cell, { scope: 'col', 'aria-sort': active && selected === index ? (direction === 'asc' ? 'ascending' : 'descending') : 'none' },
        <button type="button" className="table-sort-button" onClick={() => change(index)} title={`Sort by ${text(cell.props.children)}`}>
          {cell.props.children}<span aria-hidden="true">{active && selected === index ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
        </button>) : cell
    ))));
    if (part.type === 'tbody' && active) {
      const rows = elements(part.props.children);
      return cloneElement(part, {}, sortRows(rows, (row) => value(elements(row.props.children)[selected]), direction));
    }
    return part;
  })}</table>;
}
