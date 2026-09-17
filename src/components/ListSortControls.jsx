import React from 'react';
import './Sorting.css';

export default function ListSortControls({ sort, label = 'Sort by' }) {
  return <div className="list-sort-controls">
    <label>{label}<select value={sort.key} onChange={(event) => sort.update(event.target.value, sort.direction)}>
      {sort.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select></label>
    <label>Order<select value={sort.direction} onChange={(event) => sort.update(sort.key, event.target.value)}>
      <option value="asc">Ascending</option><option value="desc">Descending</option>
    </select></label>
  </div>;
}
