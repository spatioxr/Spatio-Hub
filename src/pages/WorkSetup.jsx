import React from 'react';
import Projects from './Projects';
import WorkSetupLayout from '../components/WorkSetupLayout';
import CostingSettings from '../components/CostingSettings';

export default function WorkSetup({ section = 'projects' }) {
  return section === 'costing'
    ? <WorkSetupLayout><CostingSettings /></WorkSetupLayout>
    : <Projects mode="setup" />;
}
