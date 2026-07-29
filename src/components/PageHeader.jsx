import React from 'react';

const PageHeader = ({ eyebrow, title, description, actions }) => (
  <header className="page-header">
    <div className="page-header-copy">
      {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </header>
);

export default PageHeader;
