import React from 'react';
import DailyReportSettings from '../components/DailyReportSettings';
import Layout from '../components/Layout';

const WorkdayCheckIns = () => (
  <Layout
    title="Workday Check-ins"
    eyebrow="Settings · Superadmin"
    heading="Workday Check-ins"
    description="Choose whether each employee must submit a start-of-day plan and end-of-day summary."
  >
    <DailyReportSettings />
  </Layout>
);

export default WorkdayCheckIns;
